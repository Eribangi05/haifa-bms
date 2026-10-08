import React from 'react';
import { useApp, usePoll } from '../../lib/app';
import type { DriverStatus } from '../../lib/types';
import { Banner, Btn, Screen, SkeletonCard } from '../../ui/components';
import { Onboarding } from './onboarding';
import { Working } from './working';

/** Driver mode root: loads the driver's status, then shows the application (onboarding) or the working screen. */
export function DriverHome() {
  const { t, client, setMode, errMsg } = useApp();
  const st = usePoll(() => client.get<DriverStatus>('/drivers/me/status'), 10000);
  const d = st.data;
  if (!d) return (
    <Screen title={t('drv.mode')} onBack={() => setMode('passenger')}>
      {st.error ? <Banner kind="bad" text={errMsg(st.error)} action={<Btn title={t('common.retry')} onPress={st.reload} />} /> : <><SkeletonCard /><SkeletonCard /></>}
    </Screen>
  );
  return d.profile.status === 'APPROVED' ? <Working status={d} reload={st.reload} /> : <Onboarding status={d} reload={st.reload} />;
}
