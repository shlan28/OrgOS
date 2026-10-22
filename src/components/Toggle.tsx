import './Toggle.css'

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  title?: string
  onChange: (next: boolean) => void
}

/** Settings 式启停开关 */
export default function Toggle({ checked, disabled, title, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}
