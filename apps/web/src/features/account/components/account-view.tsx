'use client';

import { useState } from 'react';
import { ChangePasswordCard } from './change-password-card';
import { ProfileCard } from './profile-card';
import { SessionsCard } from './sessions-card';

export function AccountView() {
  // A password change signs out the other devices: reload their list afterwards.
  const [sessionsVersion, setSessionsVersion] = useState(0);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tài khoản</h1>
        <p className="text-sm text-muted-foreground">
          Thông tin đăng nhập, mật khẩu và các thiết bị đang dùng tài khoản của bạn.
        </p>
      </div>
      <ProfileCard />
      <ChangePasswordCard onChanged={() => setSessionsVersion((v) => v + 1)} />
      <SessionsCard version={sessionsVersion} />
    </div>
  );
}
