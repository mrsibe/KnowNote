import { ipcMain, BrowserWindow } from 'electron'
import { ProviderManager } from '../providers/ProviderManager'
import { providersManager } from '../config'
import { enrichModelsWithType, mergeModels } from '../../shared/utils/modelClassifier'
import { ProviderSchemas, validate } from './validation'
import { getBuiltinModels } from '../../shared/config/models'

/**
 * Provider 설정 관련 IPC 핸들러 등록
 */
export function registerProviderHandlers(providerManager: ProviderManager) {
  // 프로바이더 설정 저장 (Electron Store 직접 사용, 즉시 반영) (매개변수 검증 포함)
  ipcMain.handle(
    'save-provider-config',
    validate(ProviderSchemas.saveProviderConfig, async (args) => {
      await providersManager.saveProviderConfig(args.providerName, args.config, args.enabled)

      // 사용자 정의 프로바이더이면서 활성화된 경우, ProviderManager에 등록
      if (args.enabled && !providerManager.getDescriptor(args.providerName)) {
        const customConfig = {
          providerName: args.providerName,
          displayName: args.config.displayName || args.providerName,
          baseUrl: args.config.baseUrl || '',
          apiKey: args.config.apiKey || ''
        }

        if (customConfig.baseUrl) {
          await providerManager.registerCustomProvider(customConfig)
        }
      }

      // 모든 윈도우에 Provider 설정 변경 이벤트 브로드캐스트
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // 단일 프로바이더 설정 조회 (Electron Store에서 읽기) (매개변수 검증 포함)
  ipcMain.handle(
    'get-provider-config',
    validate(ProviderSchemas.getProviderConfig, async (args) => {
      return await providersManager.getProviderConfig(args.providerName)
    })
  )

  // 모든 프로바이더 설정 조회 (Electron Store에서 읽기)
  ipcMain.handle('get-all-provider-configs', async () => {
    return await providersManager.getAllProviderConfigs()
  })

  // 프로바이더 설정 삭제 (매개변수 검증 포함)
  ipcMain.handle(
    'delete-provider-config',
    validate(ProviderSchemas.deleteProviderConfig, async (args) => {
      await providersManager.deleteProviderConfig(args.providerName)
      // 모든 윈도우에 Provider 설정 변경 이벤트 브로드캐스트
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // 프로바이더 설정 검증 (매개변수 검증 포함)
  ipcMain.handle(
    'validate-provider-config',
    validate(ProviderSchemas.validateProviderConfig, async (args) => {
      const provider = providerManager.getProvider(args.providerName)
      if (!provider || !provider.validateConfig) {
        return false
      }
      return provider.validateConfig(args.config)
    })
  )

  // 모델 목록 조회 (매개변수 검증 포함)
  ipcMain.handle(
    'fetch-models',
    validate(ProviderSchemas.fetchModels, async (args) => {
      try {
        // 1. 내장 모델 조회 (항상 사용 가능)
        const builtinModels = getBuiltinModels(args.providerName)

        // 2. 네트워크 요청으로 최신 모델 조회 시도
        try {
          let url = ''
          let rawModels: any[] = []

          // 내장 프로바이더별 URL 설정
          if (args.providerName === 'openai') {
            url = 'https://api.openai.com/v1/models'
          } else if (args.providerName === 'deepseek') {
            url = 'https://api.deepseek.com/models'
          } else if (args.providerName === 'ollama' || args.providerName === 'lmstudio') {
            // 로컬 프로바이더: 설정에서 baseUrl 조회
            const providerConfig = await providersManager.getProviderConfig(args.providerName)
            const defaultBaseUrl =
              args.providerName === 'ollama'
                ? 'http://localhost:11434'
                : 'http://localhost:1234/v1'
            const baseUrl = providerConfig?.config.baseUrl || defaultBaseUrl

            if (args.providerName === 'ollama') {
              // Ollama: OpenAI 호환 형식 시도 후 실패 시 네이티브 형식으로 폴백
              const cleanBaseUrl = baseUrl.replace(/\/(api)?\/?$/, '')
              const openaiUrl = `${cleanBaseUrl}/v1/models`
              console.log(`[Ollama] Trying OpenAI-compatible format: ${openaiUrl}`)

              try {
                const openaiResponse = await fetch(openaiUrl, {
                  method: 'GET',
                  headers: { Accept: 'application/json' }
                })

                if (openaiResponse.ok) {
                  const openaiData = await openaiResponse.json()
                  rawModels = openaiData.data || []
                  console.log(
                    `[Ollama] Successfully fetched ${rawModels.length} models using OpenAI format`
                  )
                } else {
                  throw new Error(`OpenAI format failed with status: ${openaiResponse.status}`)
                }
              } catch (openaiError) {
                // Ollama 네이티브 형식으로 폴백
                console.log(
                  `[Ollama] OpenAI format failed, falling back to native format:`,
                  openaiError
                )
                const nativeUrl = `${cleanBaseUrl}/api/tags`
                console.log(`[Ollama] Trying native format: ${nativeUrl}`)

                const nativeResponse = await fetch(nativeUrl, {
                  method: 'GET',
                  headers: { Accept: 'application/json' }
                })

                if (!nativeResponse.ok) {
                  throw new Error(`HTTP error! status: ${nativeResponse.status}`)
                }

                const nativeData = await nativeResponse.json()
                rawModels = nativeData.models || []
                console.log(
                  `[Ollama] Successfully fetched ${rawModels.length} models using native format`
                )
              }
            } else {
              // LM Studio: OpenAI 호환 API 직접 사용
              const cleanBaseUrl = baseUrl.replace(/\/?$/, '')
              url = `${cleanBaseUrl}/models`
              console.log(`[LM Studio] Fetching models from: ${url}`)

              const response = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' }
              })

              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
              }

              const data = await response.json()
              rawModels = data.data || data.models || []
              console.log(`[LM Studio] Fetched ${rawModels.length} models`)
            }

            // 로컬 프로바이더 모델 정규화 및 병합
            const normalizedModels = rawModels.map((model: any) => ({
              id: model.id || model.name || '',
              object: model.object || 'model',
              owned_by: model.owned_by,
              created: model.created,
              type: model.type
            }))

            const remoteModels = enrichModelsWithType(normalizedModels)

            // 스마트 병합 전략: 원격 정보 + 내장 메타데이터
            const mergedModels = mergeModels(builtinModels, remoteModels)

            console.log(
              `[Models] ${args.providerName}: ${builtinModels.length} builtin + ${remoteModels.length} remote = ${mergedModels.length} total`
            )

            await providersManager.saveProviderModels(args.providerName, mergedModels)

            return {
              models: mergedModels,
              source: 'merged',
              builtinCount: builtinModels.length,
              remoteCount: remoteModels.length
            }
          } else {
            // 사용자 정의 프로바이더: 설정에서 baseUrl 조회
            const providerConfig = await providersManager.getProviderConfig(args.providerName)
            if (!providerConfig || !providerConfig.config.baseUrl) {
              throw new Error(`Custom provider ${args.providerName} has no baseUrl configured`)
            }
            const baseUrl = providerConfig.config.baseUrl
            url = baseUrl.endsWith('/') ? `${baseUrl}models` : `${baseUrl}/models`
          }

          // 기타 provider 공통 처리
          const headers: Record<string, string> = {
            Accept: 'application/json',
            Authorization: `Bearer ${args.apiKey}`
          }

          const response = await fetch(url, {
            method: 'GET',
            headers
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data = await response.json()
          rawModels = data.data || data.models || []

          // 모델 객체 정규화
          const normalizedModels = rawModels.map((model: any) => ({
            id: model.id || model.name || '',
            object: model.object || 'model',
            owned_by: model.owned_by,
            created: model.created,
            type: model.type
          }))

          // 모델 타입 정보 추가
          const remoteModels = enrichModelsWithType(normalizedModels)

          // 3. 스마트 병합 전략: 원격 정보 + 내장 메타데이터
          const mergedModels = mergeModels(builtinModels, remoteModels)

          console.log(
            `[Models] ${args.providerName}: ${builtinModels.length} builtin + ${remoteModels.length} remote = ${mergedModels.length} total`
          )

          // 4. 병합된 모델 목록 저장
          await providersManager.saveProviderModels(args.providerName, mergedModels)

          return {
            models: mergedModels,
            source: 'merged',
            builtinCount: builtinModels.length,
            remoteCount: remoteModels.length
          }
        } catch (networkError) {
          // 5. 네트워크 실패 시 내장 모델 반환 (있는 경우)
          console.warn(`[Fetch Failed] ${args.providerName}:`, networkError)

          if (builtinModels.length > 0) {
            console.log(`[Fallback] Using ${builtinModels.length} builtin models`)
            return {
              models: builtinModels,
              source: 'builtin',
              error: (networkError as Error).message
            }
          }

          // 6. 내장 모델도 없으면 에러 발생
          throw new Error(`모델 목록을 조회할 수 없습니다: ${(networkError as Error).message}`)
        }
      } catch (error) {
        console.error('Failed to fetch models:', error)
        throw error
      }
    })
  )

  // 캐시된 모델 목록 조회 (매개변수 검증 포함)
  ipcMain.handle(
    'get-provider-models',
    validate(ProviderSchemas.getProviderModels, async (args) => {
      return await providersManager.getProviderModels(args.providerName)
    })
  )

  console.log('[IPC] Provider handlers registered')
}
