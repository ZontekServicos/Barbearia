/**
 * Prova que os binários nativos carregam NESTE ambiente, no build.
 *
 * `@node-rs/argon2` é um módulo nativo: o pacote certo para a plataforma é
 * escolhido na instalação. Se faltar — lockfile ignorado, libc inesperada,
 * imagem base trocada — o build continua verde e a falha aparece no PRIMEIRO
 * LOGIN em produção, como "erro interno" sem relação aparente com deploy.
 *
 * Rodar um hash de verdade aqui transforma isso num build vermelho, que é
 * barato de diagnosticar e impossível de ignorar.
 *
 * Em .mjs puro de propósito: não depende de `tsx` nem de nada em
 * devDependencies, que a imagem de produção pode podar depois do build.
 */
const started = Date.now()

try {
  const argon2 = await import("@node-rs/argon2")
  const hash = await argon2.hash("smoke-test-nao-e-senha-de-ninguem")
  if (typeof hash !== "string" || !hash.startsWith("$argon2")) {
    throw new Error(`hash em formato inesperado: ${String(hash).slice(0, 24)}`)
  }
  // Verifica também o caminho de verificação: carregar não é o mesmo que funcionar.
  const matches = await argon2.verify(hash, "smoke-test-nao-e-senha-de-ninguem")
  if (!matches) throw new Error("verify() não reconheceu o próprio hash")

  console.log(`argon2 ok (${Date.now() - started}ms)`)
} catch (error) {
  console.error("\n  BUILD INTERROMPIDO — binário nativo do argon2 indisponível.\n")
  console.error(`  ${error instanceof Error ? error.message : String(error)}\n`)
  console.error("  Sem ele NENHUM login funciona, e a falha só apareceria em produção.")
  console.error("  Confira se a instalação usou --frozen-lockfile e se a plataforma da")
  console.error("  imagem casa com algum @node-rs/argon2-<plataforma> do lockfile.\n")
  process.exit(1)
}
