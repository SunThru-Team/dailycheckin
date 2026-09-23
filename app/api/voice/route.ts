// Twilio fetches this when the check-in call connects. Returns TwiML: ask the question, start gathering.
import twilio from 'twilio';
import { getCall } from '@/lib/db';
import { CHECKIN_PROMPT, GATHER_OPTS, VOICE, formParams, twimlResponse, verifyTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
const { VoiceResponse } = twilio.twiml;

export async function POST(req: Request) {
  const params = await formParams(req);
  if (!verifyTwilioRequest(req, params)) return new Response('Invalid signature', { status: 403 });

  const callId = Number(new URL(req.url).searchParams.get('callId'));
  const twiml = new VoiceResponse();

  // Answering machine detection: don't dictate the prompt into voicemail.
  if (params.AnsweredBy && params.AnsweredBy.startsWith('machine')) {
    twiml.hangup();
    return twimlResponse(twiml);
  }

  const call = Number.isFinite(callId) ? await getCall(callId) : null;
  if (!call) {
    twiml.say(VOICE, 'Sorry, this call could not be matched to a scheduled check-in. Goodbye.');
    twiml.hangup();
    return twimlResponse(twiml);
  }

  const gather = twiml.gather({ ...GATHER_OPTS, action: `/api/gather?callId=${callId}&seg=1&silent=0` });
  gather.say(VOICE, CHECKIN_PROMPT);
  gather.play({ digits: '1' }); // short tone so "after the tone" means something
  return twimlResponse(twiml);
}
