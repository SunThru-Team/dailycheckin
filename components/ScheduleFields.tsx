// Day-of-week toggles plus a time picker. Plain inputs so it works inside server-action forms.
import { DAY_NAMES } from '@/lib/time';

export function ScheduleFields({ days, time, name = 'days', timeName = 'time' }: {
  days: number[]; time: string; name?: string; timeName?: string;
}) {
  return (
    <div className="schedule-fields">
      <fieldset className="days">
        <legend>Days</legend>
        {DAY_NAMES.map((d, i) => (
          <label key={d} className="day">
            <input type="checkbox" name={name} value={i} defaultChecked={days.includes(i)} />
            <span>{d}</span>
          </label>
        ))}
      </fieldset>
      <label>Time
        <input type="time" name={timeName} defaultValue={time.slice(0, 5)} step={900} required />
      </label>
    </div>
  );
}
