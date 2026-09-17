import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption { value: string; label: ReactNode }

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  testId?: string;
}

export function Select({ value, onValueChange, options, placeholder = 'اختر', disabled = false, required = false, name, id, ariaLabel, className = '', testId }: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 16;
      const menuWidth = Math.max(rect.width, 224);
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
      const availableAbove = Math.max(0, rect.top - viewportPadding);
      const openAbove = availableBelow < 220 && availableAbove > availableBelow;
      const maxHeight = Math.max(144, Math.min(320, openAbove ? availableAbove : availableBelow));
      const right = Math.max(viewportPadding, window.innerWidth - rect.right);
      setMenuStyle({
        top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 6) : rect.bottom + 6,
        right,
        width: Math.min(menuWidth, window.innerWidth - viewportPadding * 2),
        maxHeight,
      });
    };
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
  }, [options, value]);

  const choose = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === 'ArrowDown' ? (current + 1) % Math.max(options.length, 1) : (current - 1 + options.length) % Math.max(options.length, 1));
    } else if (event.key === 'Home' && options.length) {
      event.preventDefault(); setActiveIndex(0);
    } else if (event.key === 'End' && options.length) {
      event.preventDefault(); setActiveIndex(options.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && open && options[activeIndex]) {
      event.preventDefault(); choose(options[activeIndex].value);
    } else if (event.key === 'Escape') {
      event.preventDefault(); setOpen(false);
    }
  };

  const menu = open && !disabled && typeof document !== 'undefined' ? createPortal(
    <div ref={menuRef} role="listbox" aria-label={ariaLabel} className="select-menu fixed z-[100] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-2 text-base shadow-pop" style={menuStyle}>
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return <button key={option.value} type="button" role="option" aria-selected={isSelected} className={`flex min-h-12 w-full items-center gap-2 rounded-xl px-4 py-2.5 text-right transition hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${isSelected ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-800'} ${activeIndex === index ? 'ring-1 ring-brand-200' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)}><span className="min-w-0 flex-1 truncate">{option.label}</span>{isSelected && <Check size={17} className="shrink-0 text-brand-600" aria-hidden />}</button>;
      })}
    </div>,
    document.body,
  ) : null;

  return <div className={`relative ${className}`}>
    <button ref={triggerRef} id={id} data-testid={testId} type="button" disabled={disabled} aria-label={ariaLabel} aria-required={required} aria-haspopup="listbox" aria-expanded={open} className={`flex h-12 w-full items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-right text-base transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${open ? 'border-brand-400 ring-2 ring-brand-100' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'} ${disabled ? 'cursor-not-allowed border-ink-100 bg-ink-50 text-ink-400 opacity-80' : 'text-ink-900'}`} onClick={() => setOpen((current) => !current)} onKeyDown={handleKeyDown}>
      <span className={`min-w-0 flex-1 truncate ${selected ? 'text-ink-900' : 'text-ink-400'}`}>{selected?.label ?? placeholder}</span><ChevronDown size={17} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180 text-brand-600' : ''}`} aria-hidden />
    </button>
    {name && <input type="hidden" name={name} value={value} />}
    {menu}
  </div>;
}
