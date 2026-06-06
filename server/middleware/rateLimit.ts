import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: "Message rate limit exceeded." },
});

export const identityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Identity creation rate limit exceeded." },
});
