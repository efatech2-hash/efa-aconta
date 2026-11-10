import React from 'react';
import type { Patron } from '../lib/types';
import { isSubscriptionExpired } from '../lib/checkLimits';
import { SubscriptionModal } from './SubscriptionModal';

interface SubscriptionGuardProps {
  patron?: Patron | null;
  children: React.ReactNode;
}

export const SubscriptionGuard: React.FC<SubscriptionGuardProps> = ({ patron, children }) => {
  const isExpired = isSubscriptionExpired(patron);

  return (
    <>
      {children}
      {isExpired && (
        <SubscriptionModal
          isOpen={true}
          isBlocking={true}
          patron={patron}
        />
      )}
    </>
  );
};
