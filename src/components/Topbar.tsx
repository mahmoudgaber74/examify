import { useEffect, useState } from 'react';
import { Search, Bell, HelpCircle, ChevronDown, Plus, Globe, Check } from 'lucide-react';
import { Avatar } from './ui';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/auth';
import { NAV_ITEMS, type ViewId } from '../lib/navigation';

interface UserNotification { id: string; title: string; message: string; read_at: string | null; created_at: string; }

export function Topbar({ title, subtitle, onCreateExam, onNavigate, accessibleViews = [] }: { title: string; subtitle?: string; onCreateExam?: () => void; onNavigate?: (view: ViewId) => void; accessibleViews?: ViewId[] }) {
  const { fullName, role, user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
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
    <header className="sticky top-0 z-20 bg-ink-50/85 backdrop-blur-md border-b border-ink-100">
      <div className="flex items-center gap-4 px-5 lg:px-8 h-16">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[17px] font-700 text-ink-900 tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-ink-500 truncate hidden sm:block">{subtitle}</p>}
        </div>

        <div className="relative hidden md:block w-72">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-ink-200">
          <Search size={16} className="text-ink-400" />
          <input id="global-search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="ابحث في أقسام المنصّة…" className="bg-transparent text-sm outline-none flex-1 placeholder:text-ink-400" aria-label="البحث في المنصة" />
          <kbd className="text-[10px] font-600 text-ink-400 bg-ink-100 px-1.5 py-0.5 rounded">⌘K</kbd>
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

        <div className="flex items-center gap-1">
          <button onClick={() => window.alert('استخدم القائمة الجانبية للوصول إلى الأقسام. يمكنك الرجوع إلى لوحة التحكم في أي وقت.')} className="hidden sm:grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition" title="مساعدة">
            <HelpCircle size={18} />
          </button>
          <button onClick={() => setNotificationsOpen((value) => !value)} className="relative grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition" title="الإشعارات">
            <Bell size={18} />
            {notifications.some((item) => !item.read_at) && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-danger-500 ring-2 ring-ink-50" />}
          </button>
          {notificationsOpen && <div className="absolute top-14 right-5 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-ink-100 bg-white p-3 shadow-pop">
            <div className="mb-2 flex items-center justify-between"><p className="font-700 text-ink-900">الإشعارات</p><span className="text-xs text-ink-400">{notifications.filter((item) => !item.read_at).length} جديدة</span></div>
            {notifications.length === 0 ? <p className="py-6 text-center text-sm text-ink-400">لا توجد إشعارات</p> : <div className="max-h-80 space-y-2 overflow-y-auto">{notifications.map((item) => <button key={item.id} type="button" onClick={() => void markNotificationRead(item.id)} className={`w-full rounded-xl p-3 text-right ${item.read_at ? 'bg-ink-50' : 'bg-brand-50'}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-700 text-ink-800">{item.title}</p><p className="mt-1 text-xs text-ink-600">{item.message}</p></div>{item.read_at && <Check size={14} className="text-accent-600" />}</div></button>)}</div>}
          </div>}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-ink-500 hover:bg-ink-100 transition cursor-pointer">
            <Globe size={16} />
            <span className="text-xs font-600">ع</span>
            <ChevronDown size={14} />
          </div>
          {canCreateExam && (
            <button onClick={onCreateExam} className="btn-primary !py-2 !px-3 hidden sm:inline-flex">
              <Plus size={16} />
              <span className="hidden lg:inline">امتحان جديد</span>
            </button>
          )}
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-ink-200">
            <Avatar name={fullName ?? 'مستخدم'} size={34} />
            <div className="hidden xl:block leading-tight">
              <div className="text-sm font-600 text-ink-900 truncate max-w-[140px]">{fullName ?? 'مستخدم'}</div>
              <div className="text-[11px] text-ink-500">{roleLabels[role] ?? role}</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
