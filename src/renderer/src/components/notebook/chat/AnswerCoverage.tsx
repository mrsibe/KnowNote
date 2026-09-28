import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClaimSupportReport } from '../../../../../shared/utils/claimSupport'

interface AnswerCoverageProps {
  coverage: ClaimSupportReport
}

/**
 * 这条回答的 citation coverage（#156）。
 *
 * 只报告确定的事情：哪些句子没有引用、哪些引用指向了不存在的来源、哪些句子被模型
 * 明确标注为自己的推断。它**不**声称某条引用在语义上证明了这个句子 —— 那是 NLI，
 * 不是一个规则能回答的问题，假装能回答只会给出读者会相信的错误结论。
 *
 * 没有任何未支撑陈述时不渲染：正常的回答不需要一句「一切正常」。
 */
export default function AnswerCoverage({ coverage }: AnswerCoverageProps): ReactElement | null {
  const { t } = useTranslation('chat')

  const notices: string[] = []
  if (coverage.invalid > 0) notices.push(t('answerCoverageInvalid', { count: coverage.invalid }))
  if (coverage.uncited > 0) notices.push(t('answerCoverageUncited', { count: coverage.uncited }))
  if (coverage.inference > 0)
    notices.push(t('answerCoverageInference', { count: coverage.inference }))

  if (notices.length === 0) return null

  return <p className="px-2 text-xs text-subtle-foreground">{notices.join(' ')}</p>
}
