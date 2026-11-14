import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ChatPanel } from '@/modules/assistant/ChatPanel'
import { AUTO_NAME } from './constants'

/** Chat flottant ouvert par Auto là où le panneau latéral de l'assistant n'est pas visible (éditeur plein écran). */
export function FloatingChat({ side, onClose }: { side: 'left' | 'right'; onClose: () => void }) {
  return createPortal(
    <motion.div data-auto role="dialog" aria-label={`Assistant (ouvert par ${AUTO_NAME})`} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="fixed bottom-24 z-[47] flex h-[30rem] max-h-[calc(100vh-8rem)] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur"
      style={side === 'right' ? { right: 16 } : { left: 16 }}>
      <button type="button" onClick={onClose} aria-label="Fermer le chat" className="absolute right-2 top-2 z-10 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
      <ChatPanel compact />
    </motion.div>,
    document.body,
  )
}
