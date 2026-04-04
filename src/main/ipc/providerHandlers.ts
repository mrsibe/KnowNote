import { ipcMain, BrowserWindow } from 'electron'
import { ProviderManager } from '../providers/ProviderManager'
import { providersManager } from '../config'
import { enrichModelsWithType, mergeModels } from '../../shared/utils/modelClassifier'
import { ProviderSchemas, validate } from './validation'
import { getBuiltinModels } from '../../shared/config/models'

/**
 * 등록 Provider 설정관련의 IPC Handlers
 */
export function registerProviderHandlers(providerManager: ProviderManager) {
  // 제공자 설정 저장（직접사용 Electron Store，즉시생효）（포함하는매개변수검증）
  ipcMain.handle(
    'save-provider-config',
    validate(ProviderSchemas.saveProviderConfig, async (args) => {
      await providersManager.saveProviderConfig(args.providerName, args.config, args.enabled)

      // 만약예자체정의제공자또한방금활성화,등록에 ProviderManager
      if (args.enabled && !providerManager.getDescriptor(args.providerName)) {
        // 예하나개새의자체정의제공자,필요등록
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

      // 광범위재생 Provider 설정변더이벤트에모든윈도우
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // 조회단일개제공자설정（에서 Electron Store 읽기）（포함하는매개변수검증）
  ipcMain.handle(
    'get-provider-config',
    validate(ProviderSchemas.getProviderConfig, async (args) => {
      return await providersManager.getProviderConfig(args.providerName)
    })
  )

  // 모든 제공자 설정 조회（에서 Electron Store 읽기）
  ipcMain.handle('get-all-provider-configs', async () => {
    return await providersManager.getAllProviderConfigs()
  })

  // 제공자 설정 삭제（포함하는매개변수검증）
  ipcMain.handle(
    'delete-provider-config',
    validate(ProviderSchemas.deleteProviderConfig, async (args) => {
      await providersManager.deleteProviderConfig(args.providerName)
      // 광범위재생 Provider 설정변더이벤트에모든윈도우
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // 검증제공자설정（포함하는매개변수검증）
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

  // 모델 목록 조회（포함하는매개변수검증）
  ipcMain.handle(
    'fetch-models',
    validate(ProviderSchemas.fetchModels, async (args) => {
      try {
        // 1. 조회내장모델（시작최종사용 가능）
        const builtinModels = getBuiltinModels(args.providerName)

        // 2. 시도시도네트워크네트워크요청조회최신모델
        try {
          let url = ''
          let rawModels: any[] = []

          // 내장제공자사용하드인코딩의 URL
          if (args.providerName === 'openai') {
            url = 'https://api.openai.com/v1/models'
          } else if (args.providerName === 'deepseek') {
            url = 'https://api.deepseek.com/models'
          } else if (args.providerName === 'siliconflow') {
            url = 'https://api.siliconflow.cn/v1/models'
          } else if (args.providerName === 'qwen') {
            url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models'
          } else if (args.providerName === 'kimi') {
            url = 'https://api.moonshot.cn/v1/models'
          } else if (args.providerName === 'ollama') {
            // Ollama: 먼저시도시도 OpenAI 겸용형식，실패후회뒤로에원본생형식
            const providerConfig = await providersManager.getProviderConfig(args.providerName)
            const baseUrl = providerConfig?.config.baseUrl || 'http://localhost:11434'

            // ���동제외끝끝의 /api 또는 / (만약존재)
            const cleanBaseUrl = baseUrl.replace(/\/(api)?\/?$/, '')

            // 시도시도 OpenAI 겸용형식
            const openaiUrl = `${cleanBaseUrl}/v1/models`
            console.log(`[Ollama] Trying OpenAI-compatible format: ${openaiUrl}`)

            try {
              const openaiResponse = await fetch(openaiUrl, {
                method: 'GET',
                headers: {
                  Accept: 'application/json'
                }
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
              // 회뒤로에 Ollama 원본생형식
              console.log(
                `[Ollama] OpenAI format failed, falling back to native format:`,
                openaiError
              )
              const nativeUrl = `${cleanBaseUrl}/api/tags`
              console.log(`[Ollama] Trying native format: ${nativeUrl}`)

              const nativeResponse = await fetch(nativeUrl, {
                method: 'GET',
                headers: {
                  Accept: 'application/json'
                }
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

            // Ollama 특특수처리：규범화그리고병합
            const normalizedModels = rawModels.map((model: any) => ({
              id: model.id || model.name || '',
              object: model.object || 'model',
              owned_by: model.owned_by,
              created: model.created,
              type: model.type
            }))

            const remoteModels = enrichModelsWithType(normalizedModels)

            // 스마트병합전략：원격정보 + 내장메타데이터
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
          } else if (args.providerName === 'zhipu') {
            url = 'https://open.bigmodel.cn/api/paas/v4/models'
          } else {
            // 자체정의제공자：에서설정에서조회 baseUrl
            const providerConfig = await providersManager.getProviderConfig(args.providerName)
            if (!providerConfig || !providerConfig.config.baseUrl) {
              throw new Error(`Custom provider ${args.providerName} has no baseUrl configured`)
            }
            const baseUrl = providerConfig.config.baseUrl
            url = baseUrl.endsWith('/') ? `${baseUrl}models` : `${baseUrl}/models`
          }

          // 기타 provider 의통용처리
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

          // 규범화모델객체
          const normalizedModels = rawModels.map((model: any) => ({
            id: model.id || model.name || '',
            object: model.object || 'model',
            owned_by: model.owned_by,
            created: model.created,
            type: model.type
          }))

          // 모델추가타입정보
          const remoteModels = enrichModelsWithType(normalizedModels)

          // 3. 스마트병합전략：원격정보 + 내장메타데이터
          // 원격필드우선: id, owned_by, created (반영최신상태)
          // 내장필드우선: type, max_context, description (정밀하게설정)
          const mergedModels = mergeModels(builtinModels, remoteModels)

          console.log(
            `[Models] ${args.providerName}: ${builtinModels.length} builtin + ${remoteModels.length} remote = ${mergedModels.length} total`
          )

          // 4. 저장병합후의모델목록
          await providersManager.saveProviderModels(args.providerName, mergedModels)

          return {
            models: mergedModels,
            source: 'merged',
            builtinCount: builtinModels.length,
            remoteCount: remoteModels.length
          }
        } catch (networkError) {
          // 5. 네트워크네트워크실패，반환내장모델（만약있는）
          console.warn(`[Fetch Failed] ${args.providerName}:`, networkError)

          if (builtinModels.length > 0) {
            console.log(`[Fallback] Using ${builtinModels.length} builtin models`)
            return {
              models: builtinModels,
              source: 'builtin',
              error: (networkError as Error).message
            }
          }

          // 6. 없있는내장모델，던짐오류
          throw new Error(`없음방법모델 목록 조회: ${(networkError as Error).message}`)
        }
      } catch (error) {
        console.error('Failed to fetch models:', error)
        throw error
      }
    })
  )

  // 조회캐시의모델목록（포함하는매개변수검증）
  ipcMain.handle(
    'get-provider-models',
    validate(ProviderSchemas.getProviderModels, async (args) => {
      return await providersManager.getProviderModels(args.providerName)
    })
  )

  console.log('[IPC] Provider handlers registered')
}
