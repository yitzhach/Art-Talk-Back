// assistant Worker — Phase 3. Calls studio-api over a Service Binding; never touches the database.
export default {
  async fetch(): Promise<Response> {
    return new Response("assistant: not built yet", { status: 501 });
  },
} satisfies ExportedHandler;
