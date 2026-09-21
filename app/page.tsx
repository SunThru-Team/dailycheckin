export default function Home() {
  return (
    <main className="page">
      <header className="top">
        <h1>Daily check-in</h1>
        <p className="who">Each weekday morning the system calls you and asks what you worked on.</p>
      </header>
      <p>Your dashboard is at a personal link that was sent to you. Open that link to review your updates, fix a transcription within 20 minutes of the call, or reschedule a call you missed.</p>
      <p className="muted small">Lost the link? Ask whoever set up your check-in to resend it.</p>
    </main>
  );
}
