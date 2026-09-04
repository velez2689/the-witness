export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 8vw",
        maxWidth: 900,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "var(--live)",
          marginBottom: 28,
        }}
      >
        SYSTEM READY &middot; NO SESSION
      </div>

      <h1 style={{ fontSize: "clamp(38px, 7vw, 76px)", margin: 0, fontWeight: 500 }}>
        The Witness
      </h1>

      <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--ink-soft)", maxWidth: 620 }}>
        Payer call memory. It rides along on the call a biller is already making,
        captures what the payer said as a timestamped record, and speaks up the
        moment the payer contradicts something it said on an earlier call about
        the same claim.
      </p>

      <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "40px 0 24px" }} />

      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: 0 }}>
        We don&apos;t predict what the payer will pay. We record what the payer said.
      </p>
    </main>
  );
}
