import { create } from 'zustand'
import type { Quiz, QuizSession } from '../../../main/db/schema'

interface QuizStore {
  // 核心状态
  currentQuiz: Quiz | null
  currentQuestionIndex: number
  answers: Record<string, number> // questionId -> answerIndex
  showHints: Record<string, boolean> // questionId -> showHint
  isGenerating: boolean
  generationProgress: { stage: string; progress: number } | null

  // Dialog状态
  isDialogOpen: boolean
  isResultMode: boolean // 是否显示结果页
  isReviewMode: boolean // 是否查看详情模式（浏览已答题，不可修改）

  // Actions
  setCurrentQuiz: (quiz: Quiz | null) => void
  setCurrentQuestionIndex: (index: number) => void
  setAnswer: (questionId: string, answerIndex: number) => void
  toggleHint: (questionId: string) => void
  setIsGenerating: (isGenerating: boolean) => void
  setGenerationProgress: (progress: { stage: string; progress: number } | null) => void
  setDialogOpen: (open: boolean) => void
  setResultMode: (isResult: boolean) => void
  setReviewMode: (isReview: boolean) => void

  // 计算属性
  getCorrectCount: () => number
  getTotalQuestions: () => number

  // 异步操作
  loadLatestQuiz: (notebookId: string) => Promise<void>
  loadQuiz: (quizId: string) => Promise<void>
  generateQuiz: (
    notebookId: string,
    options?: {
      questionCount?: number
      difficulty?: 'easy' | 'medium' | 'hard'
      customPrompt?: string
    }
  ) => Promise<void>
  submitQuiz: () => Promise<QuizSession | null>
  resetQuiz: () => void
}

export const useQuizStore = create<QuizStore>()((set, get) => ({
  // 初始状态
  currentQuiz: null,
  currentQuestionIndex: 0,
  answers: {},
  showHints: {},
  isGenerating: false,
  generationProgress: null,
  isDialogOpen: false,
  isResultMode: false,
  isReviewMode: false,

  // Setters
  setCurrentQuiz: (quiz) => set({ currentQuiz: quiz }),
  setCurrentQuestionIndex: (index) => set({ currentQuestionIndex: index }),
  setAnswer: (questionId, answerIndex) =>
    set((state) => ({
      answers: { ...state.answers, [questionId]: answerIndex }
    })),
  toggleHint: (questionId) =>
    set((state) => ({
      showHints: { ...state.showHints, [questionId]: !state.showHints[questionId] }
    })),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),
  setDialogOpen: (open) => set({ isDialogOpen: open }),
  setResultMode: (isResult) => set({ isResultMode: isResult }),
  setReviewMode: (isReview) => set({ isReviewMode: isReview }),

  // 计算属性
  getCorrectCount: () => {
    const { currentQuiz, answers } = get()
    if (!currentQuiz) return 0

    const questions = currentQuiz.questionsData
    let correctCount = 0

    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    return correctCount
  },

  getTotalQuestions: () => {
    const { currentQuiz } = get()
    if (!currentQuiz) return 0
    const questions = currentQuiz.questionsData
    return questions.length
  },

  // 异步操作
  loadLatestQuiz: async (notebookId: string) => {
    try {
      const quiz = await window.api.quiz.getLatest(notebookId)
      set({ currentQuiz: quiz })
    } catch (error) {
      console.error('Failed to load latest quiz:', error)
    }
  },

  loadQuiz: async (quizId: string) => {
    try {
      const quiz = await window.api.quiz.get(quizId)
      set({ currentQuiz: quiz })
    } catch (error) {
      console.error('Failed to load quiz:', error)
    }
  },

  generateQuiz: async (
    notebookId: string,
    options?: {
      questionCount?: number
      difficulty?: 'easy' | 'medium' | 'hard'
      customPrompt?: string
    }
  ) => {
    set({ isGenerating: true, generationProgress: { stage: 'starting', progress: 0 } })
    try {
      const result = await window.api.quiz.generate(notebookId, options)
      if (result.success && result.quizId) {
        const quiz = await window.api.quiz.get(result.quizId)
        set({
          currentQuiz: quiz,
          isGenerating: false,
          generationProgress: null,
          answers: {},
          showHints: {},
          currentQuestionIndex: 0,
          isResultMode: false
        })
      } else {
        throw new Error(result.error || 'Failed to generate quiz')
      }
    } catch (error) {
      console.error('Failed to generate quiz:', error)
      set({ isGenerating: false, generationProgress: null })
      throw error
    }
  },

  submitQuiz: async () => {
    const { currentQuiz, answers } = get()
    if (!currentQuiz) return null

    try {
      const result = await window.api.quiz.submitSession(currentQuiz.id, answers)
      if (result.success && result.sessionId) {
        const session = await window.api.quiz.getSession(result.sessionId)
        set({ isResultMode: true })
        return session
      }
      return null
    } catch (error) {
      console.error('Failed to submit quiz:', error)
      return null
    }
  },

  resetQuiz: () => {
    set({
      currentQuestionIndex: 0,
      answers: {},
      showHints: {},
      isResultMode: false,
      isReviewMode: false
    })
  }
}))

// 设置进度监听器
export function setupQuizListeners() {
  return window.api.quiz.onProgress((data) => {
    useQuizStore.setState({
      generationProgress: { stage: data.stage, progress: data.progress }
    })
  })
}
