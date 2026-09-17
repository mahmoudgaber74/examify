import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Bell, HelpCircle, ChevronDown, Plus, Globe, Check, LogOut } from 'lucide-react';
import { Avatar } from './ui';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/auth';
import { NAV_ITEMS, type ViewId } from '../lib/navigation';

interface UserNotification { id: string; title: string; message: string; read_at: string | null; created_at: string; }

export function Topbar({ title, subtitle, onCreateExam, onNavigate, accessibleViews = [] }: { title: string; subtitle?: string; onCreateExam?: () => void; onNavigate?: (view: ViewId) => void; accessibleViews?: ViewId[] }) {
  const { fullName, role, user, signOut } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const [notificationPosition, setNotificationPosition] = useState<{ top: number; left: number } | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const roleLabels: Record<string, string> = {
    super_admin: 'مدير النظام',
    school_admin: 'مدير المدرسة',
    teacher: 'معلم',
    grader: 'مصحّح',
    data_entry: 'إدخال بيانات',
    student: 'طالب',
    parent: 'ولي أمر',
  };
  const canCreateExam = ['super_admin', 'school_admin', 'teacher'].includes(role);
  const searchItems = NAV_ITEMS
    .filter((item) => accessibleViews.includes(item.id))
    .filter((item) => !search.trim() || item.label.toLocaleLowerCase('ar').includes(search.trim().toLocaleLowerCase('ar')))
    .slice(0, 7);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!notificationsOpen) {
      setNotificationPosition(null);
      return;
    }
    const updateNotificationPosition = () => {
      const bell = bellRef.current;
      if (!bell) return;
      const bellRect = bell.getBoundingClientRect();
      const menuWidth = notificationMenuRef.current?.getBoundingClientRect().width ?? 336;
      const viewportPadding = 12;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
      const left = Math.min(Math.max(bellRect.right - menuWidth, viewportPadding), maxLeft);
      setNotificationPosition({ top: bellRect.bottom + 8, left });
    };
    const frame = window.requestAnimationFrame(updateNotificationPosition);
    window.addEventListener('resize', updateNotificationPosition);
    window.addEventListener('scroll', updateNotificationPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateNotificationPosition);
      window.removeEventListener('scroll', updateNotificationPosition, true);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest('[data-topbar-menu]')) {
        setNotificationsOpen(false);
        setLanguageOpen(false);
        setAccountOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  function chooseView(view: ViewId) {
    onNavigate?.(view);
    setSearch('');
    setSearchOpen(false);
  }

  useEffect(() => {
    if (!user) return;
    supabase.from('user_notifications').select('id, title, message, read_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setNotifications((data as UserNotification[]) ?? []));
  }, [user]);

  async function markNotificationRead(id: string) {
    const readAt = new Date().toISOString();
    await supabase.from('user_notifications').update({ read_at: readAt }).eq('id', id);
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
  }

  return (
    <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/90 shadow-[0_1px_0_rgba(16,24,40,0.02)] backdrop-blur-xl">
      <div className="flex min-h-[72px] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-[1.15]">
          <h1 className="truncate font-display text-[17px] font-700 tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="hidden truncate text-xs text-ink-500 sm:block">{subtitle}</p>}
        </div>

        <div className="relative hidden w-full max-w-[360px] shrink-0 md:block">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50/70 px-3.5 shadow-sm transition focus-within:border-brand-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-50">
            <Search size={17} className="shrink-0 text-ink-400" />
            <input id="global-search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="ابحث في أقسام المنصّة…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400" aria-label="البحث في المنصة" />
            <kbd className="rounded-lg bg-white px-1.5 py-1 text-[10px] font-600 text-ink-400 shadow-sm">⌘K</kbd>
          </div>
          {searchOpen && onNavigate && (
            <div className="absolute top-12 inset-x-0 z-50 rounded-2xl border border-ink-100 bg-white p-2 shadow-pop" onMouseDown={(event) => event.preventDefault()}>
              <p className="px-2 py-1 text-[11px] font-700 text-ink-400">الوصول السريع</p>
              {searchItems.length === 0 ? <p className="px-2 py-5 text-center text-sm text-ink-400">لا توجد نتائج مطابقة</p> : searchItems.map((item) => {
                const Icon = item.icon;
                return <button type="button" key={item.id} onClick={() => chooseView(item.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm text-ink-700 hover:bg-brand-50 hover:text-brand-700"><Icon size={17} /><span className="flex-1">{item.label}</span><span className="text-[10px] text-ink-400">فتح</span></button>;
              })}
              {!search.trim() && canCreateExam && <button type="button" onClick={() => { onCreateExam?.(); setSearchOpen(false); }} className="mt-1 flex w-full items-center gap-3 rounded-xl border-t border-ink-100 px-3 pt-3 text-right text-sm font-700 text-brand-600 hover:text-brand-700"><Plus size={17} /><span>إنشاء امتحان جديد</span></button>}
            </div>
          )}
        </div>

        <div className="relative flex shrink-0 items-center gap-1 rounded-2xl border border-ink-100 bg-ink-50/70 p-1 shadow-sm" data-topbar-menu>
          <button onClick={() => window.alert('استخدم القائمة الجانبية للوصول إلى الأقسام. يمكنك الرجوع إلى لوحة التحكم في أي وقت.')} className="hidden h-10 w-10 place-items-center rounded-xl text-ink-500 transition hover:bg-white hover:text-ink-800 sm:grid" title="مساعدة">
            <HelpCircle size={18} />
          </button>
          <div className="relative" data-topbar-menu>
          <button ref={bellRef} onClick={() => setNotificationsOpen((value) => !value)} className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-500 transition hover:bg-white hover:text-ink-800" title="الإشعارات">
            <Bell size={18} />
            {notifications.some((item) => !item.read_at) && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-danger-500 ring-2 ring-ink-50" />}
          </button>
          {notificationsOpen && createPortal(<div ref={notificationMenuRef} data-topbar-menu className="fixed z-[100] w-[336px] max-w-[calc(100vw-24px)] rounded-2xl border border-ink-100 bg-white p-3 shadow-pop" style={notificationPosition ? { top: notificationPosition.top, left: notificationPosition.left } : { top: 0, left: 0, visibility: 'hidden' }}>
            <div className="mb-2 flex items-center justify-between"><p className="font-700 text-ink-900">الإشعارات</p><span className="text-xs text-ink-400">{notifications.filter((item) => !item.read_at).length} جديدة</span></div>
            {notifications.length === 0 ? <p className="py-6 text-center text-sm text-ink-400">لا توجد إشعارات</p> : <div className="max-h-80 space-y-2 overflow-y-auto">{notifications.map((item) => <button key={item.id} type="button" onClick={() => void markNotificationRead(item.id)} className={`w-full rounded-xl p-3 text-right ${item.read_at ? 'bg-ink-50' : 'bg-brand-50'}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-700 text-ink-800">{item.title}</p><p className="mt-1 text-xs text-ink-600">{item.message}</p></div>{item.read_at && <Check size={14} className="text-accent-600" />}</div></button>)}</div>}
          </div>, document.body)}
          </div>
          <button type="button" onClick={() => setLanguageOpen((value) => !value)} className="hidden h-10 items-center gap-1.5 rounded-xl px-2.5 text-ink-500 transition hover:bg-white sm:flex" aria-label="تغيير اللغة" aria-expanded={languageOpen}>
            <Globe size={16} />
            <span className="text-xs font-600">ع</span>
            <ChevronDown size={14} className={languageOpen ? 'rotate-180' : ''} />
          </button>
          {languageOpen && <div className="absolute top-12 left-12 z-50 w-44 rounded-xl border border-ink-100 bg-white p-1.5 shadow-pop">
            <button type="button" className="flex w-full items-center justify-between rounded-lg bg-brand-50 px-3 py-2.5 text-right text-sm font-600 text-brand-700"><span>&#x627;&#x644;&#x639;&#x631;&#x628;&#x64a;&#x629;</span><Check size={15} /></button>
            <button type="button" disabled className="mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-right text-sm text-ink-400"><span>English</span><span className="text-[10px]">&#x642;&#x631;&#x64a;&#x628;&#x627;&#x64b;</span></button>
          </div>}
          {canCreateExam && (
            <button onClick={onCreateExam} className="btn-primary hidden h-10 !px-3 sm:inline-flex">
              <Plus size={16} />
              <span className="hidden lg:inline">امتحان جديد</span>
            </button>
          )}
          <button type="button" onClick={() => setAccountOpen((value) => !value)} className="ml-1 flex items-center gap-2 rounded-xl border-l border-ink-200 py-1 pl-2 pr-1 transition hover:bg-white" aria-label="حساب المستخدم" aria-expanded={accountOpen}>
            <Avatar name={fullName ?? 'مستخدم'} size={34} />
            <div className="hidden xl:block leading-tight">
              <div className="text-sm font-600 text-ink-900 truncate max-w-[140px]">{fullName ?? 'مستخدم'}</div>
              <div className="text-[11px] text-ink-500">{roleLabels[role] ?? role}</div>
            </div>
          </button>
          {accountOpen && <div className="absolute top-12 left-0 z-50 w-64 rounded-xl border border-ink-100 bg-white p-2 shadow-pop">
            <div className="border-b border-ink-100 px-3 py-2"><p className="truncate text-sm font-700 text-ink-900">{fullName ?? 'مستخدم'}</p><p className="mt-1 truncate text-xs text-ink-500">{user?.email ?? '—'}</p><p className="mt-1 text-xs text-ink-400">{roleLabels[role] ?? role}</p></div>
            <button type="button" onClick={() => void signOut()} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-right text-sm text-danger-700 hover:bg-danger-50"><LogOut size={16} /><span>&#x62a;&#x633;&#x62c;&#x64a;&#x644; &#x627;&#x644;&#x62e;&#x631;&#x648;&#x62c;</span></button>
          </div>}
        </div>
      </div>
    </header>
  );
}
