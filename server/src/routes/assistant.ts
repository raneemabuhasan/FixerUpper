import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { body, params } from '../http.ts';
import { AssistantError, runTurn, type AssistantErrorCode } from '../ai/coordinator.ts';
import { ConversationStore } from '../ai/conversations.ts';
import type { ModelClient } from '../ai/model.ts';

const messageBody = z.object({
  conversationId: z.string().trim().max(64).optional(),
  mode: z.enum(['coordinator', 'baseline']).optional(),
  text: z.string().max(2000).optional(),
  decision: z.object({
    type: z.enum(['confirm_duplicate', 'reject_duplicate']),
    ticketId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  }).optional(),
});

const STATUS: Record<AssistantErrorCode, number> = {
  INVALID_INPUT: 400,
  BUSY: 409,
  INVALID_DECISION: 409,
  AI_INCOMPLETE: 503,
  AI_UNAVAILABLE: 503,
};

export function assistantRoutes(db: DB, model: ModelClient | null, store = new ConversationStore()) {
  const r = Router();

  r.get('/assistant/status', (_req, res) => {
    res.json({ available: model !== null, model: model?.name ?? null });
  });

  r.post('/residents/:residentId/assistant/messages', async (req, res, next) => {
    try {
      const { residentId } = params(req, 'residentId');
      const input = body(req, messageBody);
      res.json(await runTurn(db, model, store, residentId, input));
    } catch (err) {
      if (err instanceof AssistantError) {
        res.status(STATUS[err.code]).json({ error: { code: err.code, message: err.message }, ...(err.partial ?? {}) });
        return;
      }
      next(err);
    }
  });

  // Runs before Dev 2's reset handler: chats about the old data shouldn't survive a reset.
  r.post('/demo/reset', (_req, _res, next) => {
    store.clear();
    next();
  });

  return r;
}
