import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { readFile, readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, normalize, resolve, sep } from "node:path"

/**
 * Contrato de fallback de SPA.
 *
 * LIMITAÇÃO, dita de frente: isto NÃO executa o Railway nem o Caddy. Nenhum dos
 * dois roda aqui. O que este arquivo faz são duas coisas verificáveis:
 *
 *  1. exercita o CONTRATO que o host precisa cumprir contra o `dist` real,
 *     provando que o build suporta acesso direto a rota de React Router;
 *  2. confere que o `Caddyfile` versionado continua declarando esse contrato,
 *     para uma edição futura não removê-lo em silêncio.
 *
 * A validação de que o Railway aplica o `Caddyfile` só existe no deploy, e está
 * registrada como pendência no relatório — não dá para afirmar daqui.
 */

const root = resolve(import.meta.dirname, "..")
const dist = join(root, "dist")

/**
 * Servidor que implementa o MESMO contrato do Caddyfile.
 *
 * Reimplementado aqui de propósito: o teste precisa falhar se o contrato for
 * violado, não se o Caddy estiver ausente da máquina.
 */
function serveDist(): Server {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".txt": "text/plain; charset=utf-8",
  }

  return createServer(async (request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]!)

    // 1. A API nunca é reescrita: outro serviço responde por ela.
    if (path === "/api" || path.startsWith("/api/")) {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "not found" }))
      return
    }

    // `normalize` barra travessia de diretório (`../`).
    const candidate = join(dist, normalize(path))
    const insideDist = candidate === dist || candidate.startsWith(dist + sep)
    const isFile = insideDist && existsSync(candidate) && (await stat(candidate)).isFile()

    // 2. Asset versionado que não existe é 404 — nunca HTML.
    if (path.startsWith("/assets/") && !isFile) {
      response.writeHead(404)
      response.end("not found")
      return
    }

    // 3. Arquivo real quando existir.
    if (isFile) {
      response.writeHead(200, { "Content-Type": types[extname(candidate)] ?? "application/octet-stream" })
      response.end(await readFile(candidate))
      return
    }

    // 4. Qualquer outro caminho recebe index.html — quem decide se a rota
    //    existe é a aplicação, não o host.
    response.writeHead(200, { "Content-Type": types[".html"]! })
    response.end(await readFile(join(dist, "index.html")))
  })
}

let server: Server
let base: string
const get = async (path: string) => {
  const response = await fetch(base + path)
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body: await response.text(),
  }
}
const isAppShell = (body: string) => body.includes('id="root"') && body.includes("<script")

describe("fallback de SPA sobre o dist real", () => {
  before(async () => {
    assert.ok(
      existsSync(join(dist, "index.html")),
      "dist/index.html não existe — rode `pnpm build` antes desta suíte",
    )
    server = serveDist()
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  })

  after(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  it("entrega a aplicação na raiz", async () => {
    const response = await get("/")
    assert.equal(response.status, 200)
    assert.ok(isAppShell(response.body))
  })

  it("entrega a aplicação em /agendamento/:token — a rota que motivou isto", async () => {
    // Token no formato real: 43 caracteres base64url.
    const token = "A".repeat(43)
    for (const path of [
      `/agendamento/${token}`,
      "/agendamento",
      // Token inválido: o host entrega a aplicação, e é ela que consulta o
      // backend e mostra "não encontramos essa solicitação".
      "/agendamento/token-invalido",
      `/agendamento/${token}?utm=whatsapp`,
    ]) {
      const response = await get(path)
      assert.equal(response.status, 200, path)
      assert.ok(isAppShell(response.body), path)
      assert.match(response.type, /text\/html/, path)
    }
  })

  it("entrega a aplicação nas rotas públicas e administrativas", async () => {
    for (const path of [
      "/login",
      "/cadastro",
      "/agendar",
      "/conta/pendente",
      "/conta/bloqueada",
      "/admin",
      "/admin/agenda",
      "/admin/agenda/44444444-4444-4444-8444-444444444444",
      "/admin/clients",
      "/admin/services",
      "/admin/settings",
      "/admin/users",
      "/client",
      "/client/appointments",
    ]) {
      const response = await get(path)
      assert.equal(response.status, 200, path)
      assert.ok(isAppShell(response.body), path)
    }
  })

  it("rota de frontend desconhecida também recebe a aplicação", async () => {
    // O host não sabe quais caminhos o React conhece. Quem mostra "Página não
    // encontrada" é a rota `path="*"` da aplicação.
    const response = await get("/isto-nao-existe/em-lugar-nenhum")
    assert.equal(response.status, 200)
    assert.ok(isAppShell(response.body))
  })

  it("a API NUNCA é reescrita para a aplicação", async () => {
    for (const path of ["/api", "/api/", "/api/booking/policy", "/api/rota/inexistente"]) {
      const response = await get(path)
      assert.equal(response.status, 404, path)
      assert.ok(!isAppShell(response.body), `${path} devolveu HTML da aplicação`)
      assert.match(response.type, /application\/json/, path)
    }
  })

  it("asset versionado inexistente é 404, não HTML", async () => {
    // Devolver index.html aqui produziria erro de MIME no navegador e esconderia
    // um build quebrado atrás de uma página que aparenta carregar.
    const response = await get("/assets/index-QUE-NAO-EXISTE.js")
    assert.equal(response.status, 404)
    assert.ok(!isAppShell(response.body))
  })

  it("os assets reais do build são servidos com o tipo correto", async () => {
    const assets = await readdir(join(dist, "assets"))
    const script = assets.find(name => name.endsWith(".js"))
    const style = assets.find(name => name.endsWith(".css"))
    assert.ok(script, "o build não produziu JS")
    assert.ok(style, "o build não produziu CSS")

    const js = await get(`/assets/${script}`)
    assert.equal(js.status, 200)
    assert.match(js.type, /javascript/)
    const css = await get(`/assets/${style}`)
    assert.equal(css.status, 200)
    assert.match(css.type, /text\/css/)

    // E o index.html referencia exatamente esses arquivos.
    const html = (await get("/")).body
    assert.ok(html.includes(`/assets/${script}`), "index.html não aponta para o JS do build")
  })

  it("o index.html usa caminhos absolutos na raiz", async () => {
    // Com `base` diferente de "/", um deep link carregaria index.html e então
    // pediria os assets no caminho errado — tela branca em vez de 404.
    const html = (await get("/")).body
    const sources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]!)
    const locais = sources.filter(source => !/^(https?:)?\/\//.test(source) && !source.startsWith("data:"))
    assert.ok(locais.length > 0, "nenhuma referência local no index.html")
    for (const source of locais) {
      assert.ok(source.startsWith("/"), `referência relativa quebra deep link: ${source}`)
    }
  })

  it("travessia de diretório não sai do dist", async () => {
    const response = await get("/../package.json")
    assert.ok(!response.body.includes('"name"') || isAppShell(response.body))
  })
})

describe("o Caddyfile versionado declara o contrato", () => {
  let config: string

  before(async () => {
    config = await readFile(join(root, "Caddyfile"), "utf8")
  })

  it("existe e serve o diretório do build", () => {
    assert.match(config, /root \* \{\$FRONTEND_DIST:dist\}/)
  })

  it("declara o fallback para index.html", () => {
    // É a linha que faz `/agendamento/<token>` funcionar por acesso direto.
    assert.match(config, /try_files \{path\} \/index\.html/)
  })

  it("recusa /api em vez de reescrever", () => {
    assert.match(config, /@api path \/api \/api\/\*/)
    assert.match(config, /handle @api \{\s*\n\s*error 404/)
  })

  it("serve /assets sem fallback, para asset ausente ser 404", () => {
    const assetsBlock = config.slice(config.indexOf("@assets"), config.indexOf("handle {"))
    assert.match(assetsBlock, /file_server/)
    assert.ok(
      !assetsBlock.includes("try_files"),
      "fallback em /assets devolveria HTML no lugar de um asset ausente",
    )
  })

  it("usa a porta da plataforma", () => {
    assert.match(config, /:\{\$PORT:\d+\}/)
  })

  it("não põe index.html em cache longo", () => {
    // O index.html aponta para os assets com hash novo a cada publicação.
    assert.match(config, /header \/index\.html Cache-Control "no-cache/)
  })
})
