export interface NotificationMessage {
  eventId: string;
  eventType: string;
  tenant: { id: string; name: string };
  appointment: {
    id: string;
    startsAt: string;
    status: string;
    serviceNames: string[];
  };
  recipient: {
    name: string;
    email: string | null;
    phone: string;
  };
}

export interface NotificationDelivery {
  provider: "dry-run" | "webhook";
  providerMessageId: string;
}
