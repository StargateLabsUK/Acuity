import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ background: '#F5F5F0' }}
    >
      <img
        src="/placeholder.svg"
        alt="Acuity"
        className="mb-12 w-full"
        style={{ maxWidth: 240, height: 'auto' }}
      />

      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 320 }}>
        <button
          onClick={() => navigate('/crew')}
          className="w-full rounded-lg"
          style={{
            padding: '18px 0',
            background: '#FFFFFF',
            border: '1px solid #E2E2DE',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', color: '#1A1A1A' }}>
            CREW APP
          </span>
          <p style={{ fontSize: 13, color: '#666666', marginTop: 4 }}>
            Incidents, dispositions, transfers
          </p>
        </button>

        <button
          onClick={() => navigate('/fieldapp')}
          className="w-full rounded-lg"
          style={{
            padding: '18px 0',
            background: '#FFFFFF',
            border: '1px solid #E2E2DE',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', color: '#1A1A1A' }}>
            FIELD APP
          </span>
          <p style={{ fontSize: 13, color: '#666666', marginTop: 4 }}>
            Quick voice capture on scene
          </p>
        </button>

        <button
          onClick={() => navigate('/operations')}
          className="w-full rounded-lg"
          style={{
            padding: '18px 0',
            background: '#FFFFFF',
            border: '1px solid #E2E2DE',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', color: '#1A1A1A' }}>
            OPERATIONS
          </span>
          <p style={{ fontSize: 13, color: '#666666', marginTop: 4 }}>
            Ops log and command oversight
          </p>
        </button>
      </div>
    </div>
  );
}
