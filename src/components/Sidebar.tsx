import { useEffect, useState } from 'react';
import { NAV_ITEMS, GROUP_ORDER, type ViewId } from '../lib/navigation';
import { Sparkles, ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react';
import { useAuth } from './AuthProvider';

interface SidebarProps {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  accessibleViews: ViewId[];
}

export function Sidebar({ active, onSelect, collapsed, onToggleCollapse, accessibleViews }: SidebarProps) {
  const { fullName, role, signOut } = useAuth();
  const activeGroup = NAV_ITEMS.find((item) => item.id === active)?.group;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({ [GROUP_ORDER[0]]: true }));

  useEffect(() => {
    if (activeGroup) setOpenGroups((groups) => ({ ...groups, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <aside className={`hidden lg:flex flex-col bg-ink-950 text-ink-200 transition-all duration-300 ${collapsed ? 'w-[76px]' : 'w-[260px]'}`}>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/5">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-brand-600 text-white shrink-0">
          <Sparkles size={18} />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display font-800 text-white text-[15px] tracking-tight">إكزاميفاي AI</div>
            <div className="text-[10px] tracking-widest text-ink-400">نظام تشغيل تعليمي</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-5">
        {GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((n) => n.group === group && accessibleViews.includes(n.id));
          if (!items.length) return null;
          return (
            <div key={group}>
              {!collapsed && <button type="button" onClick={() => setOpenGroups((groups) => ({ ...groups, [group]: !groups[group] }))} className="flex w-full items-center justify-between px-3 mb-1.5 text-[10px] font-700 tracking-widest text-ink-500 hover:text-ink-300 transition" aria-expanded={openGroups[group] !== false}>
                <span>{group}</span><ChevronDown size={14} className={`transition-transform ${openGroups[group] === false ? '-rotate-90' : ''}`} />
              </button>}
              <div className={`space-y-0.5 ${!collapsed && openGroups[group] === false ? 'hidden' : ''}`}>
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      title={collapsed ? item.label : undefined}
                      data-testid={`nav-${item.id}`}
                      className={`nav-link w-full ${isActive ? 'nav-link-active !text-white !bg-brand-600/20' : ''} ${collapsed ? 'justify-center px-2' : ''}`}
                    >
                      <Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.badge && (
                        <span className="ml-auto chip bg-brand-500/20 text-brand-300 px-1.5 py-0.5 text-[10px]">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/5">
        {!collapsed && fullName && (
          <div className="px-3 py-2 mb-2">
            <div className="text-xs text-ink-400">{roleLabel(role)}</div>
            <div className="text-sm font-600 text-white truncate">{fullName}</div>
          </div>
        )}
        <button onClick={onToggleCollapse} className="nav-link w-full text-ink-400 hover:text-white">
          {collapsed ? <ChevronLeft size={18} className="mx-auto" /> : <><ChevronRight size={18} /><span>طيّ القائمة</span></>}
        </button>
        <button onClick={signOut} data-testid="auth-logout" className="nav-link w-full text-ink-400 hover:text-danger-400 mt-1">
          {collapsed ? <ChevronLeft size={18} className="mx-auto rotate-90" /> : <><ChevronRight size={18} className="rotate-90" /><span>تسجيل الخروج</span></>}
        </button>
      </div>
    </aside>
  );
}

interface MobileNavProps {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  accessibleViews: ViewId[];
}

export function MobileNav({ active, onSelect, accessibleViews }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const activeGroup = NAV_ITEMS.find((item) => item.id === active)?.group;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({ [GROUP_ORDER[0]]: true }));
  const { fullName, role, signOut } = useAuth();
  const activeItem = NAV_ITEMS.find((n) => n.id === active);
  useEffect(() => {
    if (activeGroup) setOpenGroups((groups) => ({ ...groups, [activeGroup]: true }));
  }, [activeGroup]);
  return (
    <>
      <div className="lg:hidden sticky top-0 z-30 bg-ink-950 text-white px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-brand-600"><Sparkles size={16} /></div>
          <span className="font-display font-800 text-sm">إكزاميفاي AI</span>
        </div>
        <button data-testid="mobile-nav-toggle" onClick={() => setOpen(!open)} className="text-sm font-600 text-ink-200">
          {activeItem?.label ?? 'القائمة'}
        </button>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink-950/95 p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
            {GROUP_ORDER.map((group) => {
              const items = NAV_ITEMS.filter((item) => item.group === group && accessibleViews.includes(item.id));
              if (!items.length) return null;
              return <div key={group} className="mb-3">
                <button type="button" onClick={() => setOpenGroups((groups) => ({ ...groups, [group]: !groups[group] }))} className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-700 tracking-wide text-ink-400" aria-expanded={openGroups[group] !== false}>
                  <span>{group}</span><ChevronDown size={15} className={`transition-transform ${openGroups[group] === false ? '-rotate-90' : ''}`} />
                </button>
                <div className={`space-y-1 ${openGroups[group] === false ? 'hidden' : ''}`}>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return <button key={item.id} data-testid={`nav-${item.id}`} onClick={() => { onSelect(item.id); setOpen(false); }} className={`nav-link w-full ${active === item.id ? 'nav-link-active' : ''}`}><Icon size={18} /><span>{item.label}</span></button>;
                  })}
                </div>
              </div>;
            })}
            {fullName && (
              <div className="pt-3 mt-3 border-t border-white/10">
                <div className="text-xs text-ink-400 px-3">{roleLabel(role)}</div>
                <div className="text-sm font-600 text-white px-3 py-1">{fullName}</div>
                <button onClick={signOut} data-testid="auth-logout" className="nav-link w-full text-danger-400 mt-1">
                  <ChevronRight size={18} className="rotate-90" /><span>تسجيل الخروج</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    super_admin: 'مدير النظام',
    school_admin: 'مدير المدرسة',
    teacher: 'معلم',
    grader: 'مصحّح',
    data_entry: 'إدخال بيانات',
    student: 'طالب',
    parent: 'ولي أمر',
    anonymous: 'زائر',
  };
  return labels[role] ?? role;
}
