import { getConsumerChannel } from '../loaders/rabbitmq.js';
import { prisma } from '../models/index.js';
import { notifyUser } from '../utils/publishers.js';
import type { NotifiableUser } from '../utils/publishers.js';

const QUEUE = 'billing-user-svc';
const EXCHANGE = 'billing';
const ROUTING_KEY = '#';

// Consumed event shapes from the billing service
interface BillingBlockedEvent {
  type: 'org.billing_blocked';
  org_id: string;
  reason?: string;
}

interface BillingUnblockedEvent {
  type: 'org.billing_unblocked';
  org_id: string;
}

type BillingEvent = BillingBlockedEvent | BillingUnblockedEvent;

const getOrgAdmins = (orgId: string) =>
  prisma.user.findMany({
    where: {
      org_id: orgId,
      status: 'active',
      deleted_at: null,
      user_roles: {
        some: {
          role: { slug: 'org-admin' },
        },
      },
    },
    select: { email: true, phone_number: true, fcm_token: true, notif_channel: true, locale: true },
  });

export const initBillingSubscriber = async (): Promise<void> => {
  const ch = await getConsumerChannel();

  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString()) as BillingEvent;

      if (event.type === 'org.billing_blocked' || event.type === 'org.billing_unblocked') {
        const org = await prisma.org.findUnique({ where: { id: event.org_id }, select: { name: true } });
        const orgName = org?.name ?? event.org_id;
        const admins = await getOrgAdmins(event.org_id);
        const pushType = event.type === 'org.billing_blocked' ? 'org.suspended' : 'welcome' as const;
        for (const admin of admins) {
          notifyUser(admin as NotifiableUser, {
            sms: admin.phone_number
              ? { type: 'org.suspended', phone_number: admin.phone_number, org_name: orgName }
              : undefined,
            mail: admin.email
              ? { type: 'org.suspended', email: admin.email, org_name: orgName }
              : undefined,
            push: { type: pushType, data: { org_name: orgName } },
          });
        }
      }

      ch.ack(msg);
    } catch (err) {
      console.error('[billing-subscriber] Failed to process message', err);
      ch.nack(msg, false, false);
    }
  });

  console.warn(`[billing-subscriber] Listening on ${QUEUE}`);
};
