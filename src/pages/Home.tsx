import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ background: '#F5F5F0' }}
    >
      <h1 className="font-logo text-4xl text-center mb-2" style={{ color: '#1A1A1A' }}>
        ACUITY
      </h1>
      <p style={{ color: '#666666', fontSize: 14, letterSpacing: '0.15em', textAlign: 'center', marginBottom: 48 }}>
        Real-time Field Intelligence
      </p>

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
      </div>
    </div>
  );
}
