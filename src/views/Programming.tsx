import { Card, Badge, SectionHeader } from '../components/ui';
import { Code2, FileWarning, Lock, Play, Shield } from 'lucide-react';

export function Programming() {
  return <div className="space-y-6">
    <Card className="p-6"><SectionHeader title="Programming" subtitle="Secure code execution" action={<Code2 size={18} className="text-brand-600" />} /><div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 p-5"><div className="flex items-center gap-3"><Lock size={20} className="text-warning-700" /><div><Badge tone="warning">Unavailable</Badge><p className="mt-2 text-sm text-warning-800">Code execution is not currently configured. No code was executed.</p></div></div></div></Card>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[{ label: 'Execution', value: 'Unavailable', icon: Play }, { label: 'Sandbox', value: 'Required', icon: Lock }, { label: 'Plagiarism', value: 'Unavailable', icon: Shield }, { label: 'Submissions', value: 'Unavailable', icon: FileWarning }].map((item) => <Card key={item.label} className="p-4"><item.icon size={18} className="mb-2 text-ink-400" /><p className="text-xs text-ink-500">{item.label}</p><p className="font-display font-700 text-ink-900">{item.value}</p></Card>)}</div>
  </div>;
}
