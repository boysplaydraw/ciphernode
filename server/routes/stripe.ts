import { Router, type Request, type Response } from "express";
import Stripe from "stripe";

const PRICE_IDS: Record<string, string | undefined> = {
  personal: process.env.STRIPE_PRICE_PERSONAL,
  team: process.env.STRIPE_PRICE_TEAM,
};

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export function createStripeRouter() {
  const router = Router();

  router.post("/create-checkout", async (req: Request, res: Response) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: "Payment not configured" });
    }

    const { email, plan } = req.body as { email?: string; plan?: string };
    if (!email || !plan) {
      return res.status(400).json({ error: "Missing email or plan" });
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL || "https://relayworks.xyz"}/?checkout=success`,
        cancel_url: `${process.env.APP_URL || "https://relayworks.xyz"}/#pricing`,
        metadata: { plan },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("[Stripe] create-checkout error:", err);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  router.post("/stripe-webhook", async (req: Request, res: Response) => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Payment not configured" });
    }

    const sig = req.headers["stripe-signature"] as string;
    const rawBody = req.rawBody as Buffer | undefined;

    if (!sig || !rawBody) {
      return res.status(400).json({ error: "Missing signature or body" });
    }

    try {
      const event = getStripe().webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        console.log(
          "[Stripe] New subscription:",
          session.customer_email,
          session.metadata?.plan,
        );
        // TODO: Provision relay access and send relay URL to customer
      }

      res.json({ received: true });
    } catch (err) {
      console.error("[Stripe] webhook error:", err);
      res.status(400).json({ error: "Webhook verification failed" });
    }
  });

  return router;
}
