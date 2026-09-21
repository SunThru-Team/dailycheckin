// Twilio posts the SpeechResult here after the employee finishes speaking.
import twilio from 'twilio';
import { getCall, saveResponse } from '@/lib/db';
import { EDIT_WINDOW_MINUTES } from '@/lib/env';
import { VOICE, formParams, twimlResponse, verifyTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
const { VoiceResponse } = twilio.twiml;

export async function POST(req: Request) {
  const params = await formParams(req);
  if (!verifyTwilioRequest(req, params)) return new Response('Invalid signature', { status: 403 });

  const url = new URL(req.url);
  const callId = Number(url.searchParams.get('callId'));
  const attempt = Number(url.searchParams.get('attempt') ?? '1');
  const transcript = (params.SpeechResult ?? '').trim();
  const twiml = new VoiceResponse();

  const call = Number.isFinite(callId) ? await getCall(callId) : null;
  if (!call) {
    twiml.say(VOICE, 'Sorry, something went wrong recording your update. Goodbye.');
    twiml.hangup();
    return twimlResponse(twiml);
  }

  if (!transcript) {
    if (attempt < 2) {
      const gather = twiml.gather({
        input: ['speech'], speechTimeout: 'auto', speechModel: 'phone_call', enhanced: true,
        timeout: 6, actionOnEmptyResult: true,
        action: `/api/gather?callId=${callId}&attempt=${attempt + 1}`, method: 'POST',
      });
      gather.say(VOICE, "I didn't catch that. Please tell me what you worked on today, any blockers, and what you need to move forward.");
      gather.play({ digits: '1' });
    } else {
      twiml.say(VOICE, 'We did not receive a response. You can reschedule this check-in from your dashboard. Goodbye.');
      twiml.hangup();
    }
    return twimlResponse(twiml);
  }

  await saveResponse(call.id, call.employee_id, transcript);

  twiml.say(VOICE,
    `Thank you. Your update has been recorded. You can review or edit it on the dashboard ` +
    `within the next ${EDIT_WINDOW_MINUTES === 20 ? 'twenty' : EDIT_WINDOW_MINUTES} minutes. Goodbye.`);
  twiml.hangup();
  return twimlResponse(twiml);
}
