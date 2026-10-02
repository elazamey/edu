fetch('/api/health')
  .then(response => {
    if (!response.ok) throw new Error('Service unavailable');
    return response.json();
  })
  .then(data => {
    document.querySelector('#status').textContent = `Service: ${data.status}`;
  })
  .catch(() => {
    document.querySelector('#status').textContent = 'Service unavailable';
  });
