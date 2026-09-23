// Twilio posts here after each pause in speech, or when the employee presses a key.
// Each segment is appended to the response; the call ends only when they press #
// (or after two consecutive silences / the segment cap, as a safety net).
import twilio from 'twilio';
import { getCall, saveResponse } from '@/lib/db';
import { EDIT_WINDOW_MINUTES } from '@/lib/env';
import { GATHER_OPTS, MAX_SEGMENTS, MAX_SILENT_SEGMENTS, VOICE, formParams, twimlResponse, verifyTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
const { VoiceResponse } = twilio.twiml;

export async function POST(req: Request) {
  const params = await formParams(req);
  if (!verifyTwilioRequest(req, params)) return new Response('Invalid signature', { status: 403 });

  const url = new URL(req.url);
  const callId = Number(url.searchParams.get('callId'));
  const seg = Number(url.searchParams.get('seg') ?? '1');
  let silent = Number(url.searchParams.get('silent') ?? '0');
  const transcript = (params.SpeechResult ?? '').trim();
  const digits = params.Digits ?? '';
  const twiml = new VoiceResponse();

  const call = Number.isFinite(callId) ? await getCall(callId) : null;
  if (!call) {
    twiml.say(VOICE, 'Sorry, something went wrong recording your update. Goodbye.');
    twiml.hangup();
    return twimlResponse(twiml);
  }

  let saved = false;
  if (transcript) { await saveResponse(call.id, call.employee_id, transcript); saved = true; silent = 0; }
  else silent += 1;

  const finished = digits.includes('#') || digits.includes('*');
  const gaveUp = silent >= MAX_SILENT_SEGMENTS || seg >= MAX_SEGMENTS;

  if (finished || gaveUp) {
    const hasAnything = saved || seg > 1;
    if (hasAnything) {
      twiml.say(VOICE,
        `Thank you. Your update has been recorded. You can review or edit it on the dashboard ` +
        `within the next ${EDIT_WINDOW_MINUTES === 20 ? 'twenty' : EDIT_WINDOW_MINUTES} minutes. Goodbye.`);
    } else {
      twiml.say(VOICE, 'We did not receive a response. You can reschedule this check-in from your dashboard. Goodbye.');
    }
    twiml.hangup();
    return twimlResponse(twiml);
  }

  // Keep listening. Only speak if they've gone quiet, so we never talk over them.
  const gather = twiml.gather({ ...GATHER_OPTS, action: `/api/gather?callId=${callId}&seg=${seg + 1}&silent=${silent}` });
  if (!transcript) {
    gather.say(VOICE, seg === 1
      ? "I didn't catch that. Go ahead whenever you're ready, and press pound when you're finished."
      : 'Still there? Keep going, or press pound to finish.');
  }
  return twimlResponse(twiml);
}
