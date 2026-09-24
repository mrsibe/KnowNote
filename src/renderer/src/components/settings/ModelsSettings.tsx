import { ReactElement, useEffect, useState } from 'react'
import type { ConnectionMap, ModelCapability } from '../../../../shared/types'
import ModelConnectionForm, { type ProtocolInfo } from './ModelConnectionForm'
import EmbeddingSettings from './EmbeddingSettings'

interface ModelsSettingsProps {
  connections: ConnectionMap
  onConnectionsChange: (connections: ConnectionMap) => void
}

export default function ModelsSettings({
  connections,
  onConnectionsChange
}: ModelsSettingsProps): ReactElement {
  const [protocols, setProtocols] = useState<ProtocolInfo[]>([])

  useEffect(() => {
    const loadProtocols = async (): Promise<void> => {
      const infos = await window.api.connections.getProtocols()
      setProtocols(infos)
    }
    void loadProtocols()
  }, [])

  const setConnection = (
    capability: ModelCapability,
    connection: ConnectionMap[ModelCapability]
  ) => {
    onConnectionsChange({ ...connections, [capability]: connection })
  }

  const clearConnection = (capability: ModelCapability): void => {
    const next: ConnectionMap = { ...connections }
    delete next[capability]
    onConnectionsChange(next)
  }

  return (
    <div className="flex flex-col gap-10">
      <ModelConnectionForm
        capability="chat"
        connection={connections.chat}
        protocols={protocols}
        onChange={(connection) => setConnection('chat', connection)}
        onClear={() => clearConnection('chat')}
      />
      <div className="border-t border-border" />
      <EmbeddingSettings
        connection={connections.embedding}
        protocols={protocols}
        onChange={(connection) => setConnection('embedding', connection)}
        onClear={() => clearConnection('embedding')}
      />
    </div>
  )
}
