import { Card, SectionHeader } from '../components/ui';
import { Calculator, Info } from 'lucide-react';

export function MathEngine() {
  return <div className="space-y-6">
    <SectionHeader title="Math Engine" subtitle="Mathematical handwriting recognition and step verification" />
    <Card className="p-8 text-center">
      <Info size={36} className="mx-auto mb-4 text-ink-300" />
      <Calculator size={20} className="mx-auto mb-3 text-brand-600" />
      <h2 className="font-display text-xl font-700 text-ink-900">Math Engine unavailable</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-ink-500">No verified recognition, step-grading, or capability analytics service is connected. Results and performance percentages will not be fabricated.</p>
    </Card>
  </div>;
}
