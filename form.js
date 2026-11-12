(() => {
  const form = document.getElementById('form');
  const out = document.getElementById('result');
  const button = form.querySelector('button');
  const capacities = { A101: 2, A102: 3, B201: 4 };
  let pending = false, attempt = null;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const value = id => document.getElementById(id).value.trim();
    if (!form.reportValidity()) return;
    const data = { guest_name: value('name'), email: value('email'), room_id: value('room'), check_in: value('checkin'), check_out: value('checkout'), adults: Number(value('adults')), message: value('message') };
    const fail = text => { out.textContent = text; };
    if (!data.guest_name || data.guest_name.length > 100) return fail('Please enter your full name (up to 100 characters).');
    if (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return fail('Please enter a valid email address.');
    const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
    if (!validDate(data.check_in) || !validDate(data.check_out) || data.check_out <= data.check_in) return fail('Please enter valid dates. Check-out must be after check-in.');
    if (!Object.hasOwn(capacities, data.room_id) || !Number.isInteger(data.adults) || data.adults < 1 || data.adults > capacities[data.room_id]) return fail('This apartment cannot accommodate that number of adults.');
    if (data.message.length > 500) return fail('Please keep your message within 500 characters.');
    pending = true; button.disabled = true;
    const fingerprint = JSON.stringify(data);
    if (!attempt || attempt.fingerprint !== fingerprint) {
      attempt = { fingerprint, request_id: crypto.randomUUID() };
      // Session-only retry metadata contains no guest details. Restore across reloads when available.
      try {
        const bytes = new TextEncoder().encode(fingerprint);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        const stored = JSON.parse(sessionStorage.getItem('bluehaven_retry') || 'null');
        if (stored?.digest === digest && /^[0-9a-f-]{36}$/i.test(stored.request_id)) attempt.request_id = stored.request_id;
        sessionStorage.setItem('bluehaven_retry', JSON.stringify({ digest, request_id: attempt.request_id }));
      } catch { /* In-memory retry protection remains available. */ }
    }
    pending = true; button.disabled = true; button.textContent = 'Submitting…'; form.setAttribute('aria-busy', 'true');
    out.textContent = 'Submitting your inquiry…';
    // Freeze fields during submission to avoid resetting edits made while awaiting the server.
    const fields = Array.from(form.querySelectorAll('input, select, textarea'));
    fields.forEach(field => { field.disabled = true; });
    try {
      const response = await fetch('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: attempt.request_id, ...data }), signal: AbortSignal.timeout(15000) });
      let answer;
      try { answer = await response.json(); } catch { throw Error('The server returned an unexpected response. Please try again.'); }
      if (!response.ok || answer.accepted !== true || answer.request_id !== attempt.request_id) throw Error(answer.error || 'Your inquiry could not be accepted. Please try again.');
      out.textContent = 'Your inquiry has been received. Reference: ' + answer.request_id + '. This is not a reservation confirmation.';
      form.reset(); attempt = null;
      try { sessionStorage.removeItem('bluehaven_retry'); } catch {}
    } catch (error) {
      out.textContent = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The request timed out. Acceptance could not be verified. Please retry with the same details.' : error instanceof TypeError ? 'Unable to reach the server. Check your connection and try again.' : error.message;
    } finally {
      pending = false; button.disabled = false; button.textContent = 'Send inquiry'; form.removeAttribute('aria-busy');
      fields.forEach(field => { field.disabled = false; });
    }
  });
})();
