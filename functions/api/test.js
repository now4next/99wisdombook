// Test endpoint
export async function onRequest(context) {
  return new Response(JSON.stringify({ 
    message: 'API is working!',
    path: context.request.url,
    method: context.request.method
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
