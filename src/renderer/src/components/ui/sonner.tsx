import * as React from 'react'
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4 text-primary" />,
        info: <Info className="h-4 w-4 text-muted-foreground" />,
        warning: <TriangleAlert className="h-4 w-4 text-muted-foreground" />,
        error: <OctagonX className="h-4 w-4 text-destructive" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-surface-overlay group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-elevation',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
