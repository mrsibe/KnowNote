import { ipcMain } from 'electron'
import { createNote, getNotesByNotebook, getNoteById, updateNote, deleteNote } from '../db/queries'
import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'
import { NoteSchemas, validate } from './validation'

/**
 * Generate note title using AI
 */
async function generateNoteTitle(
  providerManager: ProviderManager,
  content: string
): Promise<string> {
  try {
    const provider = await providerManager.getActiveChatProvider()
    if (!provider) {
      return 'Untitled Note'
    }

    let generatedTitle = ''

    await provider.sendMessageStream(
      [
        {
          role: 'system',
          content:
            "You are a title generation assistant. Please generate a concise title based on the user's content, no more than 20 characters, without using quotes or other symbols to wrap it."
        },
        {
          role: 'user',
          content: `Please generate a title for the following content:\n\n${content.slice(0, 500)}`
        }
      ],
      (chunk) => {
        generatedTitle += chunk.content
      },
      (error) => {
        Logger.error('NoteHandlers', 'Failed to generate title:', error)
      },
      () => {
        // Complete
      }
    )

    return generatedTitle.trim() || 'Untitled Note'
  } catch (error) {
    Logger.error('NoteHandlers', 'Error in generateNoteTitle:', error)
    return 'Untitled Note'
  }
}

/**
 * Register note-related IPC handlers
 */
export function registerNoteHandlers(providerManager: ProviderManager) {
  // Create note (매개변수 검증 포함)
  ipcMain.handle(
    'create-note',
    validate(NoteSchemas.createNote, async (args) => {
      Logger.debug('NoteHandlers', 'create-note:', {
        notebookId: args.notebookId,
        hasCustomTitle: !!args.title
      })

      try {
        // If no title provided (empty string), use AI to generate
        const title = args.title || (await generateNoteTitle(providerManager, args.content))
        const note = createNote(args.notebookId, title, args.content)
        Logger.debug('NoteHandlers', 'Note created successfully:', note.id)
        return note
      } catch (error) {
        Logger.error('NoteHandlers', 'Error creating note:', error)
        throw error
      }
    })
  )

  // Get all notes in notebook (매개변수 검증 포함)
  ipcMain.handle(
    'get-notes',
    validate(NoteSchemas.getNotes, async (args) => {
      Logger.debug('NoteHandlers', 'get-notes:', args.notebookId)
      try {
        const notes = getNotesByNotebook(args.notebookId)
        Logger.debug('NoteHandlers', `Retrieved ${notes.length} notes`)
        return notes
      } catch (error) {
        Logger.error('NoteHandlers', 'Error getting notes:', error)
        throw error
      }
    })
  )

  // Get single note (매개변수 검증 포함)
  ipcMain.handle(
    'get-note',
    validate(NoteSchemas.getNote, async (args) => {
      Logger.debug('NoteHandlers', 'get-note:', args.id)
      try {
        const note = getNoteById(args.id)
        return note
      } catch (error) {
        Logger.error('NoteHandlers', 'Error getting note:', error)
        throw error
      }
    })
  )

  // Update note (매개변수 검증 포함)
  ipcMain.handle(
    'update-note',
    validate(NoteSchemas.updateNote, async (args) => {
      Logger.debug('NoteHandlers', 'update-note:', { id: args.id, updates: args.updates })
      try {
        updateNote(args.id, args.updates)
        Logger.debug('NoteHandlers', 'Note updated successfully:', args.id)
        return { success: true }
      } catch (error) {
        Logger.error('NoteHandlers', 'Error updating note:', error)
        throw error
      }
    })
  )

  // Delete note (매개변수 검증 포함)
  ipcMain.handle(
    'delete-note',
    validate(NoteSchemas.deleteNote, async (args) => {
      Logger.debug('NoteHandlers', 'delete-note:', args.id)
      try {
        deleteNote(args.id)
        Logger.debug('NoteHandlers', 'Note deleted successfully:', args.id)
        return { success: true }
      } catch (error) {
        Logger.error('NoteHandlers', 'Error deleting note:', error)
        throw error
      }
    })
  )
}
