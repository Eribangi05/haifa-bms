import React from 'react';
import { useApp, usePoll } from '../../lib/app';
import { label } from '../../lib/i18n';
import { Banner, Card, ProgressBar, Text } from '../../ui/components';
import { S } from '../../ui/theme';

type OB = {
  status: string; percent: number; next_action: { kind: 'upload'; doc_type: string; remaining: number } | { kind: 'submit' } | null;
  review: { target_hours: number; waiting_hours: number | null; late: boolean };
};

/** Where the application stands: how many documents are in, what to do next, and how long the review has taken against our target. */
export function OnboardingTracker() {
  const { t, lang, client } = useApp();
  const ob = usePoll(() => client.get<OB>('/drivers/me/onboarding'), 15000, [], true, 'driver:onboarding');
  const d = ob.data; if (!d) return null;
  const inReview = ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(d.status);
  return (
    <Card>
      <Text style={S.bold}>{inReview ? t('ob.review.title') : t('ob.progress.title')}</Text>
      {!inReview ? <ProgressBar value={d.percent / 100} label={t('ob.percent', { p: d.percent })} /> : null}
      {!inReview && d.next_action?.kind === 'upload' ? <Text style={[S.body, { marginTop: 6 }]}>{t('ob.next.upload', { doc: label(lang, 'doc', d.next_action.doc_type) })}</Text> : null}
      {!inReview && d.next_action?.kind === 'submit' ? <Text style={[S.body, { marginTop: 6 }]}>{t('ob.next.submit')}</Text> : null}
      {inReview && d.review.waiting_hours != null ? <Text style={S.muted}>{t('ob.review.wait', { h: d.review.waiting_hours, target: d.review.target_hours })}</Text> : null}
      {inReview && d.review.late ? <Banner text={t('ob.review.late')} /> : null}
    </Card>
  );
}
