import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Shared render-job lifecycle used by both the manual Studio and the Auto
 * Generator pages: POST a prepared FormData to /api/generate, join the job's
 * Socket.io room, and track phase / progress / result / attribution /
 * warnings / errors.
 *
 * @returns {{phase: string, percent: number, stage: string, resultUrl: string|null,
 *   attribution: object|null, errorMessage: string, warnings: string[],
 *   busy: boolean, submit: function(FormData): Promise<void>, reset: function(): void}}
 */
export default function useRenderJob() {
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | done | error
  const [percent, setPercent] = useState(0);
  const [stage, setStage] = useState('');
  const [resultUrl, setResultUrl] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [imageCredits, setImageCredits] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [warnings, setWarnings] = useState([]);

  const socketRef = useRef(null);

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => () => disconnectSocket(), [disconnectSocket]);

  const subscribeToJob = useCallback(
    (jobId) => {
      disconnectSocket();
      const socket = io({ path: '/socket.io' });
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('join', jobId));
      socket.on('progress', ({ percent: p, stage: s }) => {
        setPhase('processing');
        setPercent(p);
        setStage(s);
      });
      socket.on('warning', ({ message }) => {
        setWarnings((prev) => (prev.includes(message) ? prev : [...prev, message]));
      });
      socket.on('complete', ({ url, attribution: credit, imageCredits: images }) => {
        setPercent(100);
        setResultUrl(url);
        setAttribution(credit || null);
        setImageCredits(images || null);
        setPhase('done');
        disconnectSocket();
      });
      socket.on('error', ({ message }) => {
        setErrorMessage(message || 'Rendering failed.');
        setPhase('error');
        disconnectSocket();
      });
    },
    [disconnectSocket]
  );

  /** POST the prepared FormData and subscribe to the returned job's events. */
  const submit = useCallback(
    async (formData) => {
      setPhase('uploading');
      setPercent(0);
      setStage('Uploading files');
      setWarnings([]);
      setErrorMessage('');
      setResultUrl(null);
      setAttribution(null);
      setImageCredits(null);

      try {
        const response = await fetch('/api/generate', { method: 'POST', body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
        }
        setPhase('processing');
        setStage('Starting render');
        subscribeToJob(data.jobId);
      } catch (err) {
        setErrorMessage(err.message);
        setPhase('error');
      }
    },
    [subscribeToJob]
  );

  /** Back to idle (keeps nothing from the previous job). */
  const reset = useCallback(() => {
    disconnectSocket();
    setPhase('idle');
    setPercent(0);
    setStage('');
    setErrorMessage('');
    setWarnings([]);
    setResultUrl(null);
    setAttribution(null);
    setImageCredits(null);
  }, [disconnectSocket]);

  return {
    phase,
    percent,
    stage,
    resultUrl,
    attribution,
    imageCredits,
    errorMessage,
    warnings,
    busy: phase === 'uploading' || phase === 'processing',
    submit,
    reset,
  };
}
