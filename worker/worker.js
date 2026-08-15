const JWT_SECRET = "vovomaria_mvp_2026_trocar_depois";
const ROLES_PERMITIDOS = new Set(["admin", "vendedor", "operacao"]);
const CANAIS_VENDA_PERMITIDOS = new Set(["ROTA", "LOJA_FABRICA"]);

function normalizarRole(role) {
  return normalizeText(role).toLowerCase();
}

function rolePermitido(role) {
  return ROLES_PERMITIDOS.has(normalizarRole(role));
}

function usuarioTemRole(user, ...roles) {
  return !!user && roles.includes(user.role);
}

function acessoNegado() {
  return json({ error: "Acesso não permitido para este perfil." }, 403);
}

function resolverCanalVenda(user, canalInformado) {
  if (usuarioTemRole(user, "vendedor")) return "ROTA";
  if (usuarioTemRole(user, "operacao")) return "LOJA_FABRICA";
  if (!usuarioTemRole(user, "admin")) return null;

  const canal = normalizeText(canalInformado || "LOJA_FABRICA").toUpperCase();
  return CANAIS_VENDA_PERMITIDOS.has(canal) ? canal : null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function respostaCors(body = null, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...corsHeaders, ...headers } });
}

function json(data, status = 200) {
  return respostaCors(JSON.stringify(data), status, {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function onlyNumbers(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function normalizeText(v = "") {
  return String(v || "").trim();
}

function obterDataLocalCuiaba(instante = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instante).filter(parte => parte.type !== "literal").map(parte => [parte.type, parte.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function filtroRegistroTeste(alias = "v", somenteTeste = false) {
  const texto = `LOWER(' ' || COALESCE(${alias}.observacoes, '') || ' ')`;
  const contemPalavraTeste = `${texto} GLOB '*[^0-9a-z_]teste[^0-9a-z_]*'`;
  return somenteTeste ? contemPalavraTeste : `NOT (${contemPalavraTeste})`;
}

async function jwtSign(payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${body}.${sig64}`;
}

async function jwtVerify(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!h || !b || !s) throw new Error("Token inválido");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sig = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${b}`));
  if (!ok) throw new Error("Token inválido");
  return JSON.parse(atob(b));
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    const tokenUser = await jwtVerify(auth.replace("Bearer ", ""));
    const vendedorId = Number(tokenUser?.vendedorId || 0);
    if (!vendedorId) return null;

    const usuarioAtual = await env.DB.prepare(
      "SELECT id, nome, role, status FROM vendedores WHERE id = ?"
    ).bind(vendedorId).first();
    const role = normalizarRole(usuarioAtual?.role);
    if (!usuarioAtual || usuarioAtual.status !== "ativo" || !rolePermitido(role)) return null;

    return {
      vendedorId: Number(usuarioAtual.id),
      nome: usuarioAtual.nome,
      role,
    };
  } catch {
    return null;
  }
}

async function login(request, env) {
  const { email, senha } = await request.json();

  const vendedor = await env.DB.prepare(
    "SELECT id, nome, email, senha_hash, role, status FROM vendedores WHERE email = ?"
  ).bind(normalizeText(email)).first();
  const role = normalizarRole(vendedor?.role);

  if (!vendedor || vendedor.status !== "ativo" || !rolePermitido(role) || senha !== vendedor.senha_hash) {
    return json({ error: "Credenciais inválidas" }, 401);
  }

  const token = await jwtSign({
    vendedorId: vendedor.id,
    nome: vendedor.nome,
    role,
  });

  return json({
    token,
    vendedor: {
      id: vendedor.id,
      nome: vendedor.nome,
      email: vendedor.email,
      role,
    },
  });
}

function montarCliente(d, user) {
  const tipoPessoa = normalizeText(d.tipo_pessoa || (d.cnpj ? "PJ" : "PF")).toUpperCase();
  const cnpj = onlyNumbers(d.cnpj);
  const cpf = onlyNumbers(d.cpf);
  const documento = onlyNumbers(d.documento) || (tipoPessoa === "PF" ? cpf : cnpj);

  return {
    vendedor_id: d.vendedor_id || user.vendedorId,
    tipo_pessoa: tipoPessoa === "PF" ? "PF" : "PJ",
    documento,
    cnpj,
    cpf,
    razao_social: normalizeText(d.razao_social || d.nome_estabelecimento),
    nome_estabelecimento: normalizeText(d.nome_estabelecimento || d.razao_social || d.nome_fantasia),
    nome_fantasia: normalizeText(d.nome_fantasia || d.nome_estabelecimento || d.razao_social),
    ie: normalizeText(d.ie),
    situacao_ie: normalizeText(d.situacao_ie || (d.ie ? "informada" : "pendente")),
    responsavel_empresa: normalizeText(d.responsavel_empresa),
    responsavel_compra: normalizeText(d.responsavel_compra),
    telefone: onlyNumbers(d.telefone),
    whatsapp: onlyNumbers(d.whatsapp),
    instagram: normalizeText(d.instagram),
    email: normalizeText(d.email),
    contato_emergencia: normalizeText(d.contato_emergencia),
    cep: onlyNumbers(d.cep),
    endereco: normalizeText(d.endereco),
    cidade: normalizeText(d.cidade),
    estado: normalizeText(d.estado).toUpperCase(),
    concorrentes: normalizeText(d.concorrentes),
    observacoes_gerais: normalizeText(d.observacoes_gerais),
    status_comercial: normalizeText(d.status_comercial || d.status_cliente || "prospect"),
    status_cliente: normalizeText(d.status_cliente || "ativo"),
    ultima_visita: normalizeText(d.ultima_visita),
  };
}

function validarCliente(c) {
  const faltando = [];
  if (!c.tipo_pessoa) faltando.push("tipo_pessoa");
  if (!c.documento) faltando.push("documento");
  if (c.tipo_pessoa === "PJ" && !c.cnpj) faltando.push("cnpj");
  if (c.tipo_pessoa === "PF" && !c.cpf) faltando.push("cpf");
  if (!c.nome_fantasia && !c.razao_social && !c.nome_estabelecimento) faltando.push("nome");
  if (!c.cidade) faltando.push("cidade");
  if (!c.estado) faltando.push("estado");
  return faltando;
}

async function listarClientes(env, user) {
  const result = await env.DB.prepare(`
    SELECT c.*, vd.nome AS vendedor_nome
    FROM clientes c
    LEFT JOIN vendedores vd ON vd.id = c.vendedor_id
    ORDER BY c.nome_estabelecimento COLLATE NOCASE, c.id DESC
  `).all();

  return json(result.results || []);
}

async function obterClientePorId(env, id) {
  if (!Number.isInteger(id) || id <= 0) return json({ error: "ID de cliente inválido." }, 400);

  const cliente = await env.DB.prepare(`
    SELECT
      id, vendedor_id, tipo_pessoa, documento, cnpj, cpf,
      razao_social, nome_estabelecimento, nome_fantasia,
      ie, telefone, whatsapp, instagram, email, cep, endereco,
      cidade, estado, observacoes_gerais, status_comercial,
      status_cliente, 'cliente' AS tipo_origem
    FROM clientes
    WHERE id = ?
  `).bind(id).first();

  return cliente ? json(cliente) : json({ error: "Cliente não encontrado." }, 404);
}

async function obterClienteAvulsoPorId(env, id) {
  if (!Number.isInteger(id) || id <= 0) return json({ error: "ID de cliente avulso inválido." }, 400);

  const cliente = await env.DB.prepare(`
    SELECT
      id, vendedor_id, nome_estabelecimento, tipo_pessoa, cpf, cnpj,
      telefone, whatsapp, cep, endereco, cidade, estado,
      observacoes_gerais, status_cadastro,
      'avulso' AS tipo_origem
    FROM clientes_avulsos
    WHERE id = ?
  `).bind(id).first();

  return cliente ? json(cliente) : json({ error: "Cliente avulso não encontrado." }, 404);
}
async function criarCliente(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor")) return acessoNegado();
  const entrada = await request.json();
  const c = montarCliente(entrada, user);
  const faltando = validarCliente(c);

  if (faltando.length) {
    return json({ error: "Campos obrigatórios faltando", campos: faltando }, 400);
  }

  const existente = await env.DB.prepare(
    "SELECT id, nome_fantasia, razao_social FROM clientes WHERE documento = ?"
  ).bind(c.documento).first();

  if (existente) {
    return json({ error: "Cliente já cadastrado com este documento", existente }, 409);
  }

  const res = await env.DB.prepare(`
    INSERT INTO clientes (
      vendedor_id, tipo_pessoa, documento, cnpj, cpf,
      razao_social, nome_estabelecimento, nome_fantasia,
      ie, situacao_ie,
      responsavel_empresa, responsavel_compra,
      telefone, whatsapp, instagram, email, contato_emergencia,
      cep, endereco, cidade, estado,
      concorrentes, observacoes_gerais,
      status_comercial, status_cliente, ultima_visita,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    c.vendedor_id, c.tipo_pessoa, c.documento, c.cnpj, c.cpf,
    c.razao_social, c.nome_estabelecimento, c.nome_fantasia,
    c.ie, c.situacao_ie,
    c.responsavel_empresa, c.responsavel_compra,
    c.telefone, c.whatsapp, c.instagram, c.email, c.contato_emergencia,
    c.cep, c.endereco, c.cidade, c.estado,
    c.concorrentes, c.observacoes_gerais,
    c.status_comercial, c.status_cliente, c.ultima_visita
  ).run();

  return json({ success: true, id: res.meta.last_row_id, cliente: c });
}

async function criarClienteAvulso(request, env, user) {
  const dados = await request.json();
  const nomeEstabelecimento = normalizeText(dados.nome_estabelecimento);
  const cpf = onlyNumbers(dados.cpf);
  const cnpj = onlyNumbers(dados.cnpj);
  const tipoInformado = normalizeText(dados.tipo_pessoa).toUpperCase();
  const tipoPessoa = tipoInformado === "PF" || tipoInformado === "PJ"
    ? tipoInformado
    : (cnpj ? "PJ" : (cpf ? "PF" : null));

  if (!nomeEstabelecimento) {
    return json({ error: "Informe o nome ou identificação do cliente." }, 400);
  }
  if (cpf && cpf.length !== 11) {
    return json({ error: "CPF deve conter 11 dígitos." }, 400);
  }
  if (cnpj && cnpj.length !== 14) {
    return json({ error: "CNPJ deve conter 14 dígitos." }, 400);
  }
  if (cpf && cnpj) {
    return json({ error: "Informe somente CPF ou CNPJ." }, 400);
  }

  const cliente = {
    vendedor_id: user.vendedorId,
    tipo_pessoa: tipoPessoa,
    cnpj: cnpj || null,
    cpf: cpf || null,
    nome_estabelecimento: nomeEstabelecimento,
    telefone: onlyNumbers(dados.telefone) || null,
    whatsapp: onlyNumbers(dados.whatsapp) || null,
    cep: onlyNumbers(dados.cep) || null,
    endereco: normalizeText(dados.endereco) || null,
    cidade: normalizeText(dados.cidade) || null,
    estado: normalizeText(dados.estado).toUpperCase() || null,
    observacoes_gerais: normalizeText(dados.observacoes_gerais) || null,
    status_cadastro: "incompleto",
  };

  let res;
  try {
    console.log("DIAGNOSTICO criarClienteAvulso:", {
      dbExiste: !!env?.DB,
      nome: dados.nome_estabelecimento,
      vendedorId: user?.vendedorId
    });

    res = await env.DB.prepare(`
      INSERT INTO clientes_avulsos (
        vendedor_id, nome_estabelecimento, tipo_pessoa, cpf, cnpj,
        telefone, whatsapp, cep, endereco, cidade, estado, observacoes_gerais,
        status_cadastro,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      cliente.vendedor_id, cliente.nome_estabelecimento, cliente.tipo_pessoa,
      cliente.cpf, cliente.cnpj, cliente.telefone, cliente.whatsapp,
      cliente.cep, cliente.endereco,
      cliente.cidade, cliente.estado, cliente.observacoes_gerais,
      cliente.status_cadastro
    ).run();
  } catch (err) {
    console.error("ERRO criarClienteAvulso:", {
      message: err?.message,
      stack: err?.stack,
      dbExiste: !!env?.DB
    });

    return json({
      error: "Não foi possível salvar o cliente avulso.",
      detalhe: err.message,
    }, 500);
  }

  const criado = { id: res.meta.last_row_id, ...cliente, tipo_origem: "avulso" };
  return json({ success: true, id: criado.id, cliente: criado });
}

async function listarClientesAvulsos(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      nome_estabelecimento,
      telefone,
      whatsapp,
      cep,
      endereco,
      cidade,
      estado,
      observacoes_gerais,
      'avulso' AS tipo_origem
    FROM clientes_avulsos
    ORDER BY nome_estabelecimento COLLATE NOCASE, id DESC
  `).all();

  return json(result.results || []);
}

async function sync(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor")) return acessoNegado();
  try {
    const body = await request.json();
    const acoes = Array.isArray(body.acoes) ? body.acoes : [];
    const resultados = [];

    for (const acao of acoes) {
      if (acao.entidade !== "cliente" || acao.acao !== "INSERT") {
        resultados.push({ ok: false, motivo: "ação ignorada", acao });
        continue;
      }

      const dados = typeof acao.dados === "string" ? JSON.parse(acao.dados) : acao.dados;

      const fake = new Request("https://local/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });

      const resp = await criarCliente(fake, env, user);
      const retorno = await resp.json();

      resultados.push({
        local_id: acao.local_id || acao.id || null,
        ok: resp.ok,
        status: resp.status,
        retorno,
      });
    }

    return json({ success: true, resultados });
    } catch (err) {
    return json({
      success: false,
      error: err.message,
      stack: err.stack
    }, 500);
  }
}
async function consultarCNPJ(request) {
  try {
    const url = new URL(request.url);
    const cnpj = onlyNumbers(url.pathname.split("/").pop());

    if (cnpj.length !== 14) {
      return json({ error: "CNPJ inválido" }, 400);
    }

    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const texto = await resp.text();

    let data;
    try {
      data = JSON.parse(texto);
    } catch {
      data = { error: texto || "Resposta inválida da API de CNPJ" };
    }

    if (!resp.ok) {
      return json({
        error: data.message || data.error || "CNPJ não encontrado",
        origem: "BrasilAPI",
        status: resp.status
      }, resp.status);
    }

    return json(data);
  } catch (err) {
    return json({
      error: "Erro interno ao consultar CNPJ",
      detalhe: err.message
    }, 500);
  }
}

async function health(env) {
  try {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return json({ status: "ok", api: "Gestão Vovó Maria", banco: "conectado", tabelas: tables.results });
  } catch (err) {
    return json({ status: "erro", error: err.message }, 500);
  }
}

async function listarProdutos(request, env, user) {
  const incluirInativos = user.role === "admin" && new URL(request.url).searchParams.get("todos") === "1";
  const result = await env.DB.prepare(
    incluirInativos
      ? "SELECT * FROM produtos ORDER BY nome"
      : "SELECT * FROM produtos WHERE ativo = 'ativo' ORDER BY nome"
  ).all();

  return json(result.results || []);
}

function converterPrecoProduto(valor) {
  if (typeof valor === "number") return valor;
  const texto = normalizeText(valor).replace(/\s/g, "");
  if (!texto) return Number.NaN;
  const normalizado = texto.includes(",")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  return Number(normalizado);
}

const STATUS_PRODUTO_PERMITIDOS = new Set(["ativo", "inativo"]);

function normalizarStatusProduto(valor) {
  const status = typeof valor === "string" ? normalizeText(valor) : "";
  return STATUS_PRODUTO_PERMITIDOS.has(status) ? status : null;
}

async function gerirProduto(request, env, user, id = null) {
  try {
    if (user.role !== "admin") return json({ error: "Acesso restrito ao administrador" }, 403);
    const d = await request.json();
    const nome = normalizeText(d.nome);
    const preco = converterPrecoProduto(d.preco);
    const ativo = normalizarStatusProduto(d.ativo);
    if (!nome) return json({ error: "Informe o nome do produto." }, 400);
    if (!Number.isFinite(preco) || preco < 0) return json({ error: "Informe um preço válido e não negativo." }, 400);
    if (!ativo) return json({ error: "Status inválido. Use ativo ou inativo." }, 400);

    if (id) {
      if (!Number.isInteger(id) || id <= 0) return json({ error: "ID de produto inválido." }, 400);
      const atual = await env.DB.prepare("SELECT id FROM produtos WHERE id = ?").bind(id).first();
      if (!atual) return json({ error: "Produto não encontrado." }, 404);
      await env.DB.prepare("UPDATE produtos SET nome = ?, preco = ?, ativo = ? WHERE id = ?")
        .bind(nome, preco, ativo, id).run();
      const produto = await env.DB.prepare("SELECT * FROM produtos WHERE id = ?").bind(id).first();
      return json({ success: true, produto });
    }

    const res = await env.DB.prepare("INSERT INTO produtos (nome, preco, ativo) VALUES (?, ?, ?)")
      .bind(nome, preco, ativo).run();
    const produto = await env.DB.prepare("SELECT * FROM produtos WHERE id = ?").bind(res.meta.last_row_id).first();
    return json({ success: true, produto }, 201);
  } catch (err) {
    return json({
      error: id ? "Erro ao atualizar produto" : "Erro ao cadastrar produto",
      detalhe: err?.message || String(err),
    }, 500);
  }
}

async function criarVisita(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor", "operacao")) return acessoNegado();
  try {
    const d = await request.json();
    const canalVenda = resolverCanalVenda(user, d.canal_venda);
    const clienteId = Number(d.cliente_id || 0);
    const dataVisita = normalizeText(d.data_visita || obterDataLocalCuiaba());
    const comprou = d.comprou === "sim" || d.comprou === true ? "sim" : "nao";
    const observacoes = normalizeText(d.observacoes);
    const itens = Array.isArray(d.itens) ? d.itens : [];

    if (!canalVenda) return json({ error: "Canal da venda inválido. Use ROTA ou LOJA_FABRICA." }, 400);
    if (!clienteId) return json({ error: "Selecione um cliente." }, 400);

    const cliente = await env.DB.prepare("SELECT id, nome_fantasia, razao_social, vendedor_id FROM clientes WHERE id = ?").bind(clienteId).first();
    if (!cliente) return json({ error: "Cliente não encontrado." }, 404);
    
    let valorTotal = 0;
    const itensLimpos = itens
      .map(i => {
        const quantidade = Number(i.quantidade || 0);
        const preco = Number(i.preco_unitario || 0);
        const subtotal = quantidade * preco;
        valorTotal += subtotal;
        return {
          produto_id: i.produto_id ? Number(i.produto_id) : null,
          produto_nome: normalizeText(i.produto_nome),
          quantidade,
          preco_unitario: preco,
          subtotal
        };
      })
      .filter(i => i.quantidade > 0 && i.produto_nome);

    const visitaRes = await env.DB.prepare(`
      INSERT INTO visitas (vendedor_id, cliente_id, data_visita, canal_venda, comprou, valor_total, observacoes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(user.vendedorId, clienteId, dataVisita, canalVenda, comprou, valorTotal, observacoes).run();

    const visitaId = visitaRes.meta.last_row_id;

    for (const item of itensLimpos) {
      await env.DB.prepare(`
        INSERT INTO visita_itens (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(visitaId, item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal).run();
    }

    await env.DB.prepare("UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(dataVisita, clienteId).run();

    return json({ success: true, visita_id: visitaId, valor_total: valorTotal, itens: itensLimpos.length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function listarVisitas(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor", "operacao")) return acessoNegado();
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || obterDataLocalCuiaba();
  let result;
  if (user.role === "admin") {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")}
      ORDER BY v.id DESC
    `).bind(data).all();
  } else {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")}
      ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all();
  }
  return json(result.results || []);
}

async function relatorioDia(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor")) return acessoNegado();
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || obterDataLocalCuiaba();
  const filtroVendedor = user.role === "admin" ? "" : " AND vendedor_id = ?";
  const params = user.role === "admin" ? [data] : [data, user.vendedorId];

  const resumo = await env.DB.prepare(`
    SELECT
      COUNT(*) AS visitas,
      SUM(CASE WHEN comprou = 'sim' THEN 1 ELSE 0 END) AS compras,
      SUM(CASE WHEN comprou = 'nao' THEN 1 ELSE 0 END) AS sem_compra,
      COALESCE(SUM(valor_total), 0) AS valor_total
    FROM visitas v
    WHERE data_visita = ?${filtroVendedor} AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")}
  `).bind(...params).first();

  const itens = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade),0) AS quantidade, COALESCE(SUM(vi.subtotal),0) AS total
    FROM visita_itens vi
    INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita = ?${user.role === "admin" ? "" : " AND v.vendedor_id = ?"}
      AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")}
    GROUP BY vi.produto_nome
    ORDER BY quantidade DESC
  `).bind(...params).all();

  const visitas = await (user.role === "admin"
    ? env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data).all()
    : env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND v.status_registro = 'ATIVA' AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all());

  return json({ data, resumo, produtos: itens.results || [], visitas: visitas.results || [] });
}
async function hashTexto(texto) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function carregarVendaPorChave(env, chave) {
  const visita = await env.DB.prepare(`SELECT v.*,
    COALESCE(c.nome_fantasia, c.razao_social, c.nome_estabelecimento, ca.nome_estabelecimento, 'Consumidor') AS cliente_nome,
    COALESCE(vd.nome, 'Vendedor') AS vendedor_nome
    FROM visitas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN clientes_avulsos ca ON ca.id = v.cliente_avulso_id
    LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
    WHERE v.chave_idempotencia = ?`).bind(chave).first();
  if (!visita) return null;
  const [itens, pagamentos] = await Promise.all([
    env.DB.prepare("SELECT * FROM visita_itens WHERE visita_id = ? ORDER BY item_ordem, id").bind(visita.id).all(),
    env.DB.prepare("SELECT forma_pagamento AS forma, valor FROM visita_pagamentos WHERE visita_id = ? ORDER BY id").bind(visita.id).all(),
  ]);
  return { ...visita, itens: itens.results || [], pagamentos: pagamentos.results || [] };
}

function respostaVendaSalva(venda, cliente, user, idempotente = false) {
  const aviso = venda.estoque_status === "SEM_BAIXA"
    ? (venda.canal_venda === "ROTA" ? "Venda registrada, mas sem baixa no estoque do veículo." : "Venda registrada, mas sem baixa no Estoque Central.")
    : venda.estoque_status === "DIVERGENTE"
      ? "Venda registrada com baixa de estoque. O saldo ficou divergente e exige ajuste físico."
      : null;
  return { success: true, idempotente, visita_id: venda.id, data_visita: venda.data_visita,
    canal_venda: venda.canal_venda, created_at: venda.created_at,
    cliente: cliente?.nome_fantasia || cliente?.razao_social || cliente?.nome_estabelecimento || venda.cliente_nome || "Consumidor",
    vendedor: venda.vendedor_nome || user.nome || "Vendedor", itens: venda.itens || [],
    subtotal: (venda.itens || []).reduce((soma, item) => soma + Number(item.subtotal || 0), 0),
    desconto: Number(venda.desconto || 0), valor_total: Number(venda.valor_total || 0),
    valor_recebido: Number(venda.valor_recebido || 0), forma_pagamento: venda.forma_pagamento,
    pagamentos: venda.pagamentos || [], situacao_pagamento: venda.situacao_pagamento,
    status_registro: venda.status_registro, estoque_status: venda.estoque_status,
    estoque_motivo: venda.estoque_motivo, aviso_estoque: aviso };
}

async function alvoEstoqueValido(env, alvo, canalVenda, vendedorId, itens) {
  if (!alvo) return false;
  if (canalVenda === "ROTA") {
    const estrutura = await env.DB.prepare(`SELECT carga.id
      FROM estoque_cargas carga
      INNER JOIN estoque_locais local ON local.id = carga.local_carga_id
      WHERE carga.id = ? AND carga.status = 'ABERTA' AND carga.vendedor_id = ?
        AND carga.local_carga_id = ? AND local.tipo = 'CARGA_VENDEDOR'
        AND local.ativo = 1 AND local.vendedor_id = ?`).bind(alvo.carga_id, vendedorId, alvo.local_id, vendedorId).first();
    if (!estrutura) return false;
    const cargaItens = await env.DB.prepare("SELECT produto_id FROM estoque_carga_itens WHERE carga_id = ?").bind(alvo.carga_id).all();
    const produtos = new Set((cargaItens.results || []).map(item => Number(item.produto_id)));
    return itens.every(item => produtos.has(Number(item.produto_id)));
  }
  return !!await env.DB.prepare("SELECT id FROM estoque_locais WHERE id = ? AND tipo = 'CENTRAL' AND ativo = 1")
    .bind(alvo.local_id).first();
}

async function auditarBaixaVenda(env, chaveIdempotencia) {
  const venda = await carregarVendaPorChave(env, chaveIdempotencia);
  if (!venda) return { mensagem: "Venda não encontrada após o batch." };
  const operacoes = await env.DB.prepare(`SELECT * FROM estoque_operacoes
    WHERE tipo = 'SAIDA_VENDA' AND origem_tipo = 'VENDA' AND origem_id = ?`).bind(venda.id).all();
  if (venda.estoque_status === "NAO_APLICAVEL" || venda.estoque_status === "SEM_BAIXA") {
    return (operacoes.results || []).length ? { mensagem: "Venda sem baixa possui operação de estoque inesperada." } : null;
  }
  if (!["CONFIRMADO", "DIVERGENTE"].includes(venda.estoque_status)) return null;
  if ((operacoes.results || []).length !== 1) return { mensagem: "A venda não possui exatamente uma SAIDA_VENDA." };
  const operacao = operacoes.results[0];
  if (operacao.status !== "CONFIRMADA") return { mensagem: "A SAIDA_VENDA não está confirmada." };
  const movimentos = await env.DB.prepare(`SELECT m.*, local.tipo AS local_tipo, local.vendedor_id AS local_vendedor_id,
    carga.vendedor_id AS carga_vendedor_id, carga.local_carga_id
    FROM estoque_movimentacoes m
    INNER JOIN estoque_locais local ON local.id = m.local_id
    LEFT JOIN estoque_cargas carga ON carga.id = m.carga_id
    WHERE m.operacao_id = ? ORDER BY m.id`).bind(operacao.id).all();
  if ((movimentos.results || []).length !== venda.itens.length) return { mensagem: "Quantidade de movimentos diferente da quantidade de itens." };
  for (const item of venda.itens) {
    const movimento = (movimentos.results || []).find(m => Number(m.visita_item_id) === Number(item.id));
    if (!movimento || Number(movimento.visita_id) !== Number(venda.id) || Number(movimento.produto_id) !== Number(item.produto_id)
      || Number(movimento.quantidade) !== Number(item.quantidade) || Number(movimento.efeito) !== -1) {
      return { mensagem: `Movimento incompatível com o item #${item.id}.` };
    }
    if (venda.canal_venda === "ROTA") {
      const cargaItem = await env.DB.prepare(`SELECT id FROM estoque_carga_itens
        WHERE id = ? AND carga_id = ? AND produto_id = ?`).bind(movimento.carga_item_id, movimento.carga_id, item.produto_id).first();
      if (!movimento.carga_id || !cargaItem || movimento.local_tipo !== "CARGA_VENDEDOR"
        || Number(movimento.local_vendedor_id) !== Number(venda.vendedor_id)
        || Number(movimento.carga_vendedor_id) !== Number(venda.vendedor_id)
        || Number(movimento.local_carga_id) !== Number(movimento.local_id)) {
        return { mensagem: `Vínculo de carga inválido no item #${item.id}.` };
      }
    } else if (movimento.local_tipo !== "CENTRAL" || movimento.carga_id || movimento.carga_item_id) {
      return { mensagem: `Local central inválido no item #${item.id}.` };
    }
  }
  return null;
}

async function criarVenda(request, env, user) {
  if (!usuarioTemRole(user, "admin", "vendedor", "operacao")) return acessoNegado();
  const d = await request.json();
  const canalVenda = resolverCanalVenda(user, d.canal_venda);
  const clienteId = Number(d.cliente_id || 0);
  const clienteAvulsoId = Number(d.cliente_avulso_id || 0);
  const dataVisita = normalizeText(d.data_visita || obterDataLocalCuiaba());
  const comprou = d.comprou === "sim" || d.comprou === true ? "sim" : "nao";
  const observacoes = normalizeText(d.observacoes);
  const desconto = Number(d.desconto || 0);
  const chaveIdempotencia = normalizeText(d.chave_idempotencia);
  const itensEntrada = Array.isArray(d.itens)
    ? d.itens
    : (Array.isArray(d.produtos) ? d.produtos : []);

  if (!canalVenda) return json({ error: "Canal da venda inválido. Use ROTA ou LOJA_FABRICA." }, 400);
  if (!chaveIdempotencia || chaveIdempotencia.length > 180) return json({ error: "Chave de idempotência inválida." }, 400);
  if (!user?.vendedorId) return json({ error: "Vendedor autenticado não identificado." }, 401);
  if ((!clienteId && !clienteAvulsoId) || (clienteId && clienteAvulsoId)) {
    return json({ error: "Selecione exatamente um cliente cadastrado ou avulso." }, 400);
  }
  if (!Number.isFinite(desconto) || desconto < 0) return json({ error: "Desconto inválido." }, 400);
  if (comprou !== "sim" && (itensEntrada.length || (Array.isArray(d.pagamentos) && d.pagamentos.length)
    || desconto !== 0 || Number(d.valor_total || 0) !== 0 || Number(d.valor_recebido || 0) !== 0)) {
    return json({ error: "Visita sem compra não pode possuir itens, pagamentos, desconto ou valor de venda." }, 400);
  }

  const itens = itensEntrada.map((item, indice) => {
    const quantidade = Number(item.quantidade);
    const precoUnitario = Number(item.preco_unitario);
    return {
      produto_id: Number(item.produto_id || 0) || null,
      produto_nome: normalizeText(item.produto_nome),
      quantidade,
      preco_unitario: precoUnitario,
      subtotal: quantidade * precoUnitario,
      item_ordem: indice + 1
    };
  }).filter(item => item.produto_id || item.produto_nome || item.quantidade || item.preco_unitario);

  if (comprou === "sim" && !itens.length) return json({ error: "Adicione ao menos um produto." }, 400);
  if (itens.some(item => !item.produto_nome || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.preco_unitario) || item.preco_unitario < 0)) {
    return json({ error: "Todos os itens devem ter produto, quantidade maior que zero e preço não negativo." }, 400);
  }
  const produtosMapeados = itens.filter(item => item.produto_id).map(item => item.produto_id);
  if (new Set(produtosMapeados).size !== produtosMapeados.length) return json({ error: "Não repita o mesmo produto na venda." }, 400);

  const subtotal = comprou === "sim" ? itens.reduce((soma, item) => soma + item.subtotal, 0) : 0;
  if (desconto > subtotal) return json({ error: "O desconto não pode superar o subtotal." }, 400);
  const valorTotal = subtotal - desconto;
  const formasPermitidas = new Set(["dinheiro", "pix", "cartao", "prazo"]);
  const pagamentosEntrada = Array.isArray(d.pagamentos)
    ? d.pagamentos
    : (comprou === "sim" ? [{ forma: d.forma_pagamento || "não informado", valor: d.valor_recebido ?? valorTotal }] : []);
  const pagamentos = pagamentosEntrada.map(pagamento => ({
    forma: normalizeText(pagamento.forma || pagamento.forma_pagamento).toLowerCase(),
    valor: Number(pagamento.valor)
  }));
  if (comprou === "sim" && !pagamentos.length) return json({ error: "Informe ao menos uma forma de pagamento." }, 400);
  if (pagamentos.some(p => !formasPermitidas.has(p.forma))) return json({ error: "Forma de pagamento inválida." }, 400);
  if (pagamentos.some(p => !Number.isFinite(p.valor) || p.valor < 0)) return json({ error: "Os valores dos pagamentos devem ser numéricos e não negativos." }, 400);
  if (new Set(pagamentos.map(p => p.forma)).size !== pagamentos.length) return json({ error: "Não repita a mesma forma de pagamento." }, 400);
  const totalPagamentos = pagamentos.reduce((soma, pagamento) => soma + pagamento.valor, 0);
  if (totalPagamentos > valorTotal + 0.005) return json({ error: "A soma dos pagamentos não pode superar o total líquido." }, 400);
  const situacaoInformada = normalizeText(d.situacao_pagamento).toLowerCase();
  const permiteDiferenca = pagamentos.some(p => p.forma === "prazo") || ["parcial", "pendente"].includes(situacaoInformada);
  if (comprou === "sim" && totalPagamentos < valorTotal - 0.005 && !permiteDiferenca) {
    return json({ error: "A soma menor que o total exige uma parcela em prazo ou situação parcial/pendente." }, 400);
  }
  const valorRecebido = pagamentos.filter(p => p.forma !== "prazo").reduce((soma, pagamento) => soma + pagamento.valor, 0);
  const formaPagamento = pagamentos.length ? pagamentos.map(p => p.forma).join(" + ") : "não informado";
  const situacaoPagamento = valorTotal === 0 ? "sem_venda" : valorRecebido >= valorTotal ? "pago" : valorRecebido > 0 ? "parcial" : "pendente";

  const conteudoCanonico = JSON.stringify({ vendedor_id: Number(user.vendedorId), cliente_id: clienteId || 0,
    cliente_avulso_id: clienteAvulsoId || null, data_visita: dataVisita, canal_venda: canalVenda,
    comprou, observacoes, desconto, itens, pagamentos, situacao_pagamento: situacaoPagamento });
  const idempotenciaHash = await hashTexto(conteudoCanonico);
  const existente = await carregarVendaPorChave(env, chaveIdempotencia);
  if (existente) {
    if (existente.idempotencia_hash !== idempotenciaHash) return json({ error: "A chave de idempotência já foi usada com dados diferentes." }, 409);
    const auditoriaExistente = await auditarBaixaVenda(env, chaveIdempotencia);
    if (auditoriaExistente) return json({ error: "Falha crítica de auditoria da venda existente.", detalhe: auditoriaExistente.mensagem }, 500);
    return json(respostaVendaSalva(existente, null, user, true));
  }

  const cliente = clienteId
    ? await env.DB.prepare("SELECT id, nome_fantasia, razao_social, nome_estabelecimento FROM clientes WHERE id = ?").bind(clienteId).first()
    : await env.DB.prepare("SELECT id, nome_estabelecimento FROM clientes_avulsos WHERE id = ?").bind(clienteAvulsoId).first();
  if (!cliente) return json({ error: "Cliente não encontrado." }, 404);

  let alvo = null, estoqueStatus = comprou === "sim" ? "SEM_BAIXA" : "NAO_APLICAVEL", estoqueMotivo = null;
  if (comprou === "sim" && itens.some(item => !item.produto_id)) estoqueMotivo = "PRODUTO_NAO_MAPEADO";
  else if (comprou === "sim" && canalVenda === "ROTA") {
    alvo = await env.DB.prepare(`SELECT carga.id AS carga_id, carga.local_carga_id AS local_id
      FROM estoque_cargas carga WHERE carga.vendedor_id = ? AND carga.status = 'ABERTA'`).bind(user.vendedorId).first();
    if (!alvo) estoqueMotivo = "SEM_CARGA_ABERTA";
    else {
      const cargaItens = await env.DB.prepare("SELECT produto_id FROM estoque_carga_itens WHERE carga_id = ?").bind(alvo.carga_id).all();
      const permitidos = new Set((cargaItens.results || []).map(item => Number(item.produto_id)));
      if (itens.some(item => !permitidos.has(item.produto_id))) { alvo = null; estoqueMotivo = "PRODUTO_FORA_DA_CARGA"; }
    }
  } else if (comprou === "sim") {
    alvo = await env.DB.prepare("SELECT id AS local_id, NULL AS carga_id FROM estoque_locais WHERE tipo = 'CENTRAL' AND ativo = 1").first();
    if (!alvo) estoqueMotivo = "ESTOQUE_CENTRAL_NAO_INICIALIZADO";
  }
  if (alvo) { estoqueStatus = "CONFIRMADO"; estoqueMotivo = null; }

  const chaveOperacao = `VENDA:${chaveIdempotencia}`;
  const statements = [env.DB.prepare(`INSERT INTO visitas (
    vendedor_id, cliente_id, cliente_avulso_id, data_visita, canal_venda, comprou,
    valor_total, observacoes, forma_pagamento, valor_recebido, desconto, situacao_pagamento,
    chave_idempotencia, idempotencia_hash, status_registro, estoque_status, estoque_motivo, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVA', ?, ?, CURRENT_TIMESTAMP)`)
    .bind(user.vendedorId, clienteId || 0, clienteAvulsoId || null, dataVisita, canalVenda, comprou,
      valorTotal, observacoes, formaPagamento, valorRecebido, desconto, situacaoPagamento,
      chaveIdempotencia, idempotenciaHash, estoqueStatus, estoqueMotivo)];
  for (const item of itens) statements.push(env.DB.prepare(`INSERT INTO visita_itens
    (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal, item_ordem)
    SELECT id, ?, ?, ?, ?, ?, ? FROM visitas WHERE chave_idempotencia = ?`)
    .bind(item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal, item.item_ordem, chaveIdempotencia));
  for (const pagamento of pagamentos) statements.push(env.DB.prepare(`INSERT INTO visita_pagamentos
    (visita_id, forma_pagamento, valor, created_at)
    SELECT id, ?, ?, CURRENT_TIMESTAMP FROM visitas WHERE chave_idempotencia = ?`)
    .bind(pagamento.forma, pagamento.valor, chaveIdempotencia));
  if (alvo) {
    const condicaoAlvo = canalVenda === "ROTA" ? `EXISTS (
      SELECT 1 FROM estoque_cargas carga
      INNER JOIN estoque_locais local ON local.id = carga.local_carga_id
      WHERE carga.id = ${Number(alvo.carga_id)} AND carga.status = 'ABERTA'
        AND carga.vendedor_id = ${Number(user.vendedorId)} AND carga.local_carga_id = ${Number(alvo.local_id)}
        AND local.tipo = 'CARGA_VENDEDOR' AND local.ativo = 1 AND local.vendedor_id = ${Number(user.vendedorId)}
    )` : `EXISTS (SELECT 1 FROM estoque_locais local WHERE local.id = ${Number(alvo.local_id)} AND local.tipo = 'CENTRAL' AND local.ativo = 1)`;
    statements.push(env.DB.prepare(`INSERT INTO estoque_operacoes
      (tipo, status, data_operacao, origem_tipo, origem_id, chave_idempotencia, usuario_id, observacao, created_at)
      SELECT 'SAIDA_VENDA', 'CONFIRMADA', data_visita, 'VENDA', id, ?, ?, ?, CURRENT_TIMESTAMP
      FROM visitas WHERE chave_idempotencia = ? AND ${condicaoAlvo}`).bind(chaveOperacao, user.vendedorId,
        "Baixa automática da venda; situação do saldo calculada dentro da transação.", chaveIdempotencia));
    for (const item of itens) {
      const condicaoItem = `${condicaoAlvo} AND EXISTS (
        SELECT 1 FROM visitas visita INNER JOIN visita_itens item ON item.visita_id = visita.id
        WHERE visita.chave_idempotencia = ? AND item.item_ordem = ? AND item.produto_id = ? AND item.quantidade = ?
      )${alvo.carga_id ? ` AND EXISTS (SELECT 1 FROM estoque_carga_itens WHERE carga_id = ${Number(alvo.carga_id)} AND produto_id = ?)` : ""}`;
      statements.push(env.DB.prepare(`INSERT INTO estoque_movimentacoes
      (operacao_id, local_id, produto_id, carga_id, carga_item_id, visita_id, visita_item_id, quantidade, efeito, created_at)
      VALUES (
        COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0), ?, ?, ?,
        ${alvo.carga_id ? "(SELECT id FROM estoque_carga_itens WHERE carga_id = ? AND produto_id = ?)" : "NULL"},
        COALESCE((SELECT id FROM visitas WHERE chave_idempotencia = ?), 0),
        COALESCE((SELECT item.id FROM visita_itens item INNER JOIN visitas visita ON visita.id = item.visita_id
          WHERE visita.chave_idempotencia = ? AND item.item_ordem = ?), 0),
        CASE WHEN ${condicaoItem} THEN ? ELSE 0 END, -1, CURRENT_TIMESTAMP
      )`)
      .bind(...(alvo.carga_id
        ? [chaveOperacao, alvo.local_id, item.produto_id, alvo.carga_id, alvo.carga_id, item.produto_id,
          chaveIdempotencia, chaveIdempotencia, item.item_ordem,
          chaveIdempotencia, item.item_ordem, item.produto_id, item.quantidade, item.produto_id, item.quantidade]
        : [chaveOperacao, alvo.local_id, item.produto_id, null, chaveIdempotencia, chaveIdempotencia, item.item_ordem,
          chaveIdempotencia, item.item_ordem, item.produto_id, item.quantidade, item.quantidade])));
    }
    const coerenciaMovimentos = `
      (SELECT COUNT(*) FROM estoque_operacoes operacao WHERE operacao.chave_idempotencia = ?) = 1
      AND (SELECT COUNT(*) FROM estoque_movimentacoes movimento INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id WHERE operacao.chave_idempotencia = ?) =
          (SELECT COUNT(*) FROM visita_itens item INNER JOIN visitas visita ON visita.id = item.visita_id WHERE visita.chave_idempotencia = ?)
      AND NOT EXISTS (
        SELECT 1 FROM visita_itens item INNER JOIN visitas visita ON visita.id = item.visita_id
        LEFT JOIN estoque_movimentacoes movimento ON movimento.visita_item_id = item.id AND movimento.efeito = -1
        WHERE visita.chave_idempotencia = ? AND (
          movimento.id IS NULL OR movimento.visita_id <> visita.id OR movimento.produto_id <> item.produto_id
          OR movimento.quantidade <> item.quantidade OR movimento.local_id <> ${Number(alvo.local_id)}
          ${alvo.carga_id ? `OR movimento.carga_id <> ${Number(alvo.carga_id)} OR movimento.carga_item_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM estoque_carga_itens carga_item WHERE carga_item.id = movimento.carga_item_id
              AND carga_item.carga_id = ${Number(alvo.carga_id)} AND carga_item.produto_id = item.produto_id)` : "OR movimento.carga_id IS NOT NULL OR movimento.carga_item_id IS NOT NULL"}
        )
      )`;
    const saldoNegativo = `EXISTS (
      SELECT 1 FROM visita_itens item INNER JOIN visitas visita ON visita.id = item.visita_id
      WHERE visita.chave_idempotencia = ? AND (
        SELECT COALESCE(SUM(movimento.quantidade * movimento.efeito), 0)
        FROM estoque_movimentacoes movimento
        WHERE movimento.local_id = ${Number(alvo.local_id)} AND movimento.produto_id = item.produto_id
      ) < 0
    )`;
    statements.push(env.DB.prepare(`UPDATE visitas SET
      estoque_status = CASE WHEN ${coerenciaMovimentos} THEN CASE WHEN ${saldoNegativo} THEN 'DIVERGENTE' ELSE 'CONFIRMADO' END ELSE 'ESTRUTURA_INVALIDA' END,
      estoque_motivo = CASE WHEN ${coerenciaMovimentos} AND ${saldoNegativo} THEN 'SALDO_INSUFICIENTE' ELSE NULL END
      WHERE chave_idempotencia = ?`)
      .bind(chaveOperacao, chaveOperacao, chaveIdempotencia, chaveIdempotencia, chaveIdempotencia,
        chaveOperacao, chaveOperacao, chaveIdempotencia, chaveIdempotencia, chaveIdempotencia, chaveIdempotencia));
  }
  if (clienteId) statements.push(env.DB.prepare(`UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND EXISTS (SELECT 1 FROM visitas WHERE chave_idempotencia = ?)`)
    .bind(dataVisita, clienteId, chaveIdempotencia));
  try { await env.DB.batch(statements); }
  catch (err) {
    const concorrente = await carregarVendaPorChave(env, chaveIdempotencia);
    if (concorrente && concorrente.idempotencia_hash === idempotenciaHash) {
      const auditoriaConcorrente = await auditarBaixaVenda(env, chaveIdempotencia);
      if (auditoriaConcorrente) return json({ error: "Falha crítica de auditoria da venda concorrente.", detalhe: auditoriaConcorrente.mensagem }, 500);
      return json(respostaVendaSalva(concorrente, cliente, user, true));
    }
    if (concorrente) return json({ error: "A chave de idempotência já foi usada com dados diferentes." }, 409);
    const concorrenciaOperacional = alvo && !await alvoEstoqueValido(env, alvo, canalVenda, user.vendedorId, itens);
    if (concorrenciaOperacional) {
      const fallback = [env.DB.prepare(`INSERT INTO visitas (
        vendedor_id, cliente_id, cliente_avulso_id, data_visita, canal_venda, comprou,
        valor_total, observacoes, forma_pagamento, valor_recebido, desconto, situacao_pagamento,
        chave_idempotencia, idempotencia_hash, status_registro, estoque_status, estoque_motivo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVA', 'SEM_BAIXA', 'VINCULO_ESTOQUE_INDISPONIVEL', CURRENT_TIMESTAMP)`)
        .bind(user.vendedorId, clienteId || 0, clienteAvulsoId || null, dataVisita, canalVenda, comprou,
          valorTotal, observacoes, formaPagamento, valorRecebido, desconto, situacaoPagamento, chaveIdempotencia, idempotenciaHash)];
      for (const item of itens) fallback.push(env.DB.prepare(`INSERT INTO visita_itens
        (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal, item_ordem)
        SELECT id, ?, ?, ?, ?, ?, ? FROM visitas WHERE chave_idempotencia = ?`)
        .bind(item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal, item.item_ordem, chaveIdempotencia));
      for (const pagamento of pagamentos) fallback.push(env.DB.prepare(`INSERT INTO visita_pagamentos
        (visita_id, forma_pagamento, valor, created_at)
        SELECT id, ?, ?, CURRENT_TIMESTAMP FROM visitas WHERE chave_idempotencia = ?`)
        .bind(pagamento.forma, pagamento.valor, chaveIdempotencia));
      if (clienteId) fallback.push(env.DB.prepare(`UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND EXISTS (SELECT 1 FROM visitas WHERE chave_idempotencia = ?)`)
        .bind(dataVisita, clienteId, chaveIdempotencia));
      try { await env.DB.batch(fallback); }
      catch (fallbackError) {
        const repetida = await carregarVendaPorChave(env, chaveIdempotencia);
        if (repetida && repetida.idempotencia_hash === idempotenciaHash) {
          const auditoriaRepetida = await auditarBaixaVenda(env, chaveIdempotencia);
          if (auditoriaRepetida) return json({ error: "Falha crítica de auditoria da venda repetida.", detalhe: auditoriaRepetida.mensagem }, 500);
          return json(respostaVendaSalva(repetida, cliente, user, true));
        }
        if (repetida) return json({ error: "A chave de idempotência já foi usada com dados diferentes." }, 409);
        throw fallbackError;
      }
    } else throw err;
  }
  const venda = await carregarVendaPorChave(env, chaveIdempotencia);
  if (!venda) throw new Error("A transação da venda não foi confirmada.");
  const auditoria = await auditarBaixaVenda(env, chaveIdempotencia);
  if (auditoria) return json({ error: "Falha crítica de auditoria após registrar a venda.", detalhe: auditoria.mensagem }, 500);
  return json(respostaVendaSalva(venda, cliente, user, false), 201);
}

// Comissão estimada por fardo. Este é o único valor a alterar quando a regra comercial mudar.
const COMISSAO_POR_FARDO = 1.75;

async function relatorioPeriodo(request, env, user, somenteTeste = false) {
  if (!usuarioTemRole(user, "admin", "vendedor")) return acessoNegado();
  const url = new URL(request.url);
  const hoje = obterDataLocalCuiaba();
  const dataInicial = url.searchParams.get("data_inicial") || url.searchParams.get("data") || hoje;
  const dataFinal = url.searchParams.get("data_final") || url.searchParams.get("data") || dataInicial;
  const visaoSolicitada = normalizeText(url.searchParams.get("visao") || (user.role === "admin" ? "geral" : "vendedor")).toLowerCase();
  const origem = normalizeText(url.searchParams.get("origem") || "todos").toLowerCase();
  const vendedorInformado = normalizeText(url.searchParams.get("vendedor_id"));
  const dataValida = valor => /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
  if (!dataValida(dataInicial) || !dataValida(dataFinal)) return json({ error: "Período inválido. Use AAAA-MM-DD." }, 400);
  if (dataInicial > dataFinal) return json({ error: "A data inicial deve ser anterior à data final." }, 400);
  if (!['geral', 'vendedor', 'teste'].includes(visaoSolicitada)) return json({ error: "Visão de relatório inválida." }, 400);
  if (visaoSolicitada === "teste" && (!somenteTeste || user.role !== "admin")) {
    return json({ error: "Visão de registros de teste restrita ao administrador." }, 403);
  }
  if (!['todos', 'administracao', 'vendedores'].includes(origem)) return json({ error: "Origem inválida." }, 400);
  if (vendedorInformado && (!/^\d+$/.test(vendedorInformado) || Number(vendedorInformado) <= 0)) return json({ error: "vendedor_id inválido." }, 400);

  let visao = visaoSolicitada;
  let vendedorId = vendedorInformado ? Number(vendedorInformado) : null;
  if (user.role === "vendedor") {
    if (vendedorId && vendedorId !== Number(user.vendedorId)) return json({ error: "Você não pode consultar outro vendedor." }, 403);
    visao = "vendedor";
    vendedorId = Number(user.vendedorId);
  } else if (visao === "vendedor" && !vendedorId) {
    return json({ error: "Selecione um vendedor." }, 400);
  }

  let vendedorSelecionado = null;
  if (vendedorId) {
    vendedorSelecionado = await env.DB.prepare("SELECT id, nome, role, status FROM vendedores WHERE id = ?").bind(vendedorId).first();
    if (!vendedorSelecionado) return json({ error: "Vendedor não encontrado." }, 404);
  }

  let filtro = vendedorId ? " AND v.vendedor_id = ?" : "";
  if (user.role === "admin" && ["geral", "teste"].includes(visao) && origem === "administracao") filtro += " AND EXISTS (SELECT 1 FROM vendedores vo WHERE vo.id = v.vendedor_id AND vo.role = 'admin')";
  if (user.role === "admin" && ["geral", "teste"].includes(visao) && origem === "vendedores") filtro += " AND EXISTS (SELECT 1 FROM vendedores vo WHERE vo.id = v.vendedor_id AND vo.role = 'vendedor')";
  const filtroCanceladas = `${filtro} AND v.status_registro = 'CANCELADA'`;
  filtro += " AND v.status_registro = 'ATIVA'";
  const filtroTeste = filtroRegistroTeste("v", somenteTeste);
  const params = vendedorId ? [dataInicial, dataFinal, vendedorId] : [dataInicial, dataFinal];

  const resumo = await env.DB.prepare(`
    SELECT COUNT(*) AS visitas,
      SUM(CASE WHEN v.comprou = 'sim' THEN 1 ELSE 0 END) AS compras,
      SUM(CASE WHEN v.comprou = 'nao' THEN 1 ELSE 0 END) AS sem_compra,
      COALESCE(SUM(v.valor_total + v.desconto), 0) AS total_bruto,
      COALESCE(SUM(v.valor_total), 0) AS valor_total,
      COALESCE(SUM(v.valor_recebido), 0) AS total_recebido,
      COALESCE(SUM(v.valor_total - v.valor_recebido), 0) AS total_pendente,
      COALESCE(SUM(v.desconto), 0) AS descontos,
      COUNT(DISTINCT CASE WHEN v.cliente_avulso_id IS NOT NULL
        THEN 'A:' || v.cliente_avulso_id ELSE 'C:' || v.cliente_id END) AS clientes_atendidos
    FROM visitas v WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
  `).bind(...params).first();

  const produtos = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade), 0) AS quantidade,
      COALESCE(SUM(vi.subtotal), 0) AS total
    FROM visita_itens vi INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    GROUP BY vi.produto_nome ORDER BY quantidade DESC
  `).bind(...params).all();

  const formas = await env.DB.prepare(`
    SELECT forma_pagamento, COUNT(DISTINCT visita_id) AS vendas,
      COALESCE(SUM(valor), 0) AS total, COALESCE(SUM(recebido), 0) AS recebido,
      COALESCE(SUM(pendente), 0) AS pendente
    FROM (
      SELECT vp.visita_id, vp.forma_pagamento, vp.valor,
        CASE WHEN vp.forma_pagamento = 'prazo' THEN 0 ELSE vp.valor END AS recebido,
        CASE WHEN vp.forma_pagamento = 'prazo' THEN vp.valor ELSE 0 END AS pendente
      FROM visita_pagamentos vp INNER JOIN visitas v ON v.id = vp.visita_id
      WHERE v.comprou = 'sim' AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
      UNION ALL
      SELECT v.id, COALESCE(NULLIF(v.forma_pagamento, ''), 'não informado'), v.valor_total,
        v.valor_recebido, v.valor_total - v.valor_recebido
      FROM visitas v WHERE v.comprou = 'sim' AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
        AND NOT EXISTS (SELECT 1 FROM visita_pagamentos vp WHERE vp.visita_id = v.id)
    ) pagamentos
    GROUP BY forma_pagamento ORDER BY total DESC
  `).bind(...params, ...params).all();

  const visitas = await env.DB.prepare(`
    SELECT v.*, COALESCE(c.nome_fantasia, c.razao_social, c.nome_estabelecimento,
      ca.nome_estabelecimento, 'Consumidor') AS cliente_nome,
      CASE
        WHEN vd.role = 'admin' THEN 'Administração / Loja'
        WHEN vd.role = 'operacao' THEN 'Operação'
        ELSE COALESCE(vd.nome, 'Vendedor')
      END AS vendedor_nome,
      CASE
        WHEN vd.role = 'admin' THEN 'administracao'
        WHEN vd.role = 'operacao' THEN 'operacao'
        ELSE 'vendedor'
      END AS origem
    FROM visitas v LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN clientes_avulsos ca ON ca.id = v.cliente_avulso_id
    LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    ORDER BY v.data_visita DESC, v.id DESC
  `).bind(...params).all();

  const itensVendas = await env.DB.prepare(`
    SELECT vi.visita_id, vi.produto_id, vi.produto_nome, vi.quantidade,
      vi.preco_unitario, vi.subtotal
    FROM visita_itens vi INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    ORDER BY vi.visita_id DESC, vi.id
  `).bind(...params).all();

  const pagamentosVendas = await env.DB.prepare(`
    SELECT vp.visita_id, vp.forma_pagamento AS forma, vp.valor
    FROM visita_pagamentos vp INNER JOIN visitas v ON v.id = vp.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    ORDER BY vp.visita_id DESC, vp.id
  `).bind(...params).all();

  const canceladas = await env.DB.prepare(`
    SELECT v.*, COALESCE(c.nome_fantasia, c.razao_social, c.nome_estabelecimento,
      ca.nome_estabelecimento, 'Consumidor') AS cliente_nome, COALESCE(vd.nome, 'Vendedor') AS vendedor_nome
    FROM visitas v LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN clientes_avulsos ca ON ca.id = v.cliente_avulso_id
    LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
    WHERE v.data_visita BETWEEN ? AND ?${filtroCanceladas} AND ${filtroTeste}
    ORDER BY v.cancelada_em DESC, v.id DESC
  `).bind(...params).all();
  const itensCancelados = await env.DB.prepare(`SELECT vi.* FROM visita_itens vi
    INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtroCanceladas} AND ${filtroTeste}
    ORDER BY vi.visita_id DESC, vi.id`).bind(...params).all();
  const pagamentosCancelados = await env.DB.prepare(`SELECT vp.visita_id, vp.forma_pagamento AS forma, vp.valor
    FROM visita_pagamentos vp INNER JOIN visitas v ON v.id = vp.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtroCanceladas} AND ${filtroTeste}
    ORDER BY vp.visita_id DESC, vp.id`).bind(...params).all();

  const resumoVendedores = user.role === "admin" && ["geral", "teste"].includes(visao)
    ? await env.DB.prepare(`
      SELECT v.vendedor_id,
        CASE WHEN vd.role = 'admin' THEN 'Administração / Loja' ELSE COALESCE(vd.nome, 'Vendedor') END AS vendedor_nome,
        COUNT(*) AS visitas, SUM(CASE WHEN v.comprou = 'sim' THEN 1 ELSE 0 END) AS vendas,
        COALESCE(SUM(v.valor_total + v.desconto), 0) AS total_bruto,
        COALESCE(SUM(v.desconto), 0) AS descontos,
        COALESCE(SUM(v.valor_total), 0) AS total_liquido,
        COALESCE(SUM(v.valor_recebido), 0) AS total_recebido,
        COALESCE(SUM(v.valor_total - v.valor_recebido), 0) AS total_pendente
      FROM visitas v LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
        AND vd.role IN ('admin', 'vendedor')
      GROUP BY v.vendedor_id, vd.nome ORDER BY total_liquido DESC
    `).bind(...params).all()
    : { results: [] };

  const fechamentoDinheiro = vendedorId && vendedorSelecionado?.role === "vendedor"
    ? await env.DB.prepare(`
      SELECT COUNT(DISTINCT visita_id) AS vendas_dinheiro,
        COALESCE(SUM(valor), 0) AS total_liquido_dinheiro,
        COALESCE(SUM(recebido), 0) AS valor_recebido_dinheiro,
        COALESCE(SUM(pendente), 0) AS total_pendente_dinheiro,
        COALESCE(SUM(pendente), 0) AS diferenca_caixa,
        COALESCE(SUM(recebido), 0) AS valor_a_entregar
      FROM (
        SELECT vp.visita_id, vp.valor, vp.valor AS recebido, 0 AS pendente
        FROM visita_pagamentos vp INNER JOIN visitas v ON v.id = vp.visita_id
        WHERE vp.forma_pagamento = 'dinheiro' AND v.comprou = 'sim'
          AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
        UNION ALL
        SELECT v.id, v.valor_total, v.valor_recebido, v.valor_total - v.valor_recebido
        FROM visitas v WHERE v.comprou = 'sim' AND LOWER(TRIM(COALESCE(v.forma_pagamento, ''))) = 'dinheiro'
          AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
          AND NOT EXISTS (SELECT 1 FROM visita_pagamentos vp WHERE vp.visita_id = v.id)
      ) dinheiro
    `).bind(...params, ...params).first()
    : { vendas_dinheiro: 0, total_liquido_dinheiro: 0, valor_recebido_dinheiro: 0, total_pendente_dinheiro: 0, diferenca_caixa: 0, valor_a_entregar: 0 };

  const outrasFormas = vendedorId && vendedorSelecionado?.role === "vendedor"
    ? await env.DB.prepare(`
      SELECT forma_pagamento, COUNT(DISTINCT visita_id) AS vendas,
        COALESCE(SUM(valor), 0) AS total_liquido,
        COALESCE(SUM(recebido), 0) AS valor_recebido,
        COALESCE(SUM(pendente), 0) AS valor_pendente
      FROM (
        SELECT vp.visita_id, vp.forma_pagamento, vp.valor,
          CASE WHEN vp.forma_pagamento = 'prazo' THEN 0 ELSE vp.valor END AS recebido,
          CASE WHEN vp.forma_pagamento = 'prazo' THEN vp.valor ELSE 0 END AS pendente
        FROM visita_pagamentos vp INNER JOIN visitas v ON v.id = vp.visita_id
        WHERE vp.forma_pagamento <> 'dinheiro' AND v.comprou = 'sim'
          AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
        UNION ALL
        SELECT v.id, COALESCE(NULLIF(v.forma_pagamento, ''), 'não informado'), v.valor_total,
          v.valor_recebido, v.valor_total - v.valor_recebido
        FROM visitas v WHERE v.comprou = 'sim' AND LOWER(TRIM(COALESCE(v.forma_pagamento, ''))) <> 'dinheiro'
          AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
          AND NOT EXISTS (SELECT 1 FROM visita_pagamentos vp WHERE vp.visita_id = v.id)
      ) outras GROUP BY forma_pagamento ORDER BY total_liquido DESC
    `).bind(...params, ...params).all()
    : { results: [] };

  const fardos = vendedorId && vendedorSelecionado?.role === "vendedor"
    ? await env.DB.prepare(`
      SELECT COALESCE(SUM(vi.quantidade), 0) AS total_fardos
      FROM visita_itens vi INNER JOIN visitas v ON v.id = vi.visita_id
      LEFT JOIN produtos p ON p.id = vi.produto_id
      WHERE v.comprou = 'sim' AND LOWER(COALESCE(p.unidade, 'fardo')) = 'fardo'
        AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    `).bind(...params).first()
    : { total_fardos: 0 };

  const itensPorVisita = new Map();
  for (const item of itensVendas.results || []) {
    const chave = Number(item.visita_id);
    if (!itensPorVisita.has(chave)) itensPorVisita.set(chave, []);
    itensPorVisita.get(chave).push(item);
  }
  const pagamentosPorVisita = new Map();
  for (const pagamento of pagamentosVendas.results || []) {
    const chave = Number(pagamento.visita_id);
    if (!pagamentosPorVisita.has(chave)) pagamentosPorVisita.set(chave, []);
    pagamentosPorVisita.get(chave).push({ forma: pagamento.forma, valor: Number(pagamento.valor || 0) });
  }
  const vendasDetalhadas = (visitas.results || []).map(visita => ({
    ...visita,
    itens: itensPorVisita.get(Number(visita.id)) || [],
    pagamentos: pagamentosPorVisita.get(Number(visita.id)) || [{
      forma: visita.forma_pagamento || "não informado",
      valor: visita.forma_pagamento === "prazo"
        ? Math.max(0, Number(visita.valor_total || 0) - Number(visita.valor_recebido || 0))
        : Number(visita.valor_recebido || 0)
    }]
  }));
  const itensCanceladosPorVisita = new Map(), pagamentosCanceladosPorVisita = new Map();
  for (const item of itensCancelados.results || []) {
    if (!itensCanceladosPorVisita.has(Number(item.visita_id))) itensCanceladosPorVisita.set(Number(item.visita_id), []);
    itensCanceladosPorVisita.get(Number(item.visita_id)).push(item);
  }
  for (const pagamento of pagamentosCancelados.results || []) {
    if (!pagamentosCanceladosPorVisita.has(Number(pagamento.visita_id))) pagamentosCanceladosPorVisita.set(Number(pagamento.visita_id), []);
    pagamentosCanceladosPorVisita.get(Number(pagamento.visita_id)).push({ forma: pagamento.forma, valor: Number(pagamento.valor || 0) });
  }
  const vendasCanceladas = (canceladas.results || []).map(visita => ({ ...visita,
    itens: itensCanceladosPorVisita.get(Number(visita.id)) || [],
    pagamentos: pagamentosCanceladosPorVisita.get(Number(visita.id)) || [] }));

  const resumoVendedor = visao === "vendedor" ? {
    ...resumo,
    vendedor_id: vendedorSelecionado?.id || vendedorId,
    vendedor_nome: vendedorSelecionado?.role === "admin" ? "Administração / Loja" : (vendedorSelecionado?.nome || user.nome),
    total_fardos: Number(fardos?.total_fardos || 0),
    comissao_por_fardo: COMISSAO_POR_FARDO,
    comissao_estimada: vendedorSelecionado?.role === "vendedor" ? Number(fardos?.total_fardos || 0) * COMISSAO_POR_FARDO : 0
  } : null;

  return json({ data_inicial: dataInicial, data_final: dataFinal, registros_teste: somenteTeste,
    visao, origem, vendedor: vendedorSelecionado, resumo,
    resumo_geral: visao === "geral" ? resumo : null, resumo_vendedor: resumoVendedor,
    fechamento_dinheiro: fechamentoDinheiro, outras_formas_pagamento: outrasFormas.results || [],
    formas_pagamento: formas.results || [], resumo_vendedores: resumoVendedores.results || [],
    resumo_por_vendedor: resumoVendedores.results || [],
    produtos: produtos.results || [], visitas: vendasDetalhadas, vendas_canceladas: vendasCanceladas });
}

function idVisitaValido(id) {
  return Number.isInteger(id) && id > 0;
}

async function confirmarSenhaAdministrador(env, user, senha) {
  if (user.role !== "admin") return false;
  const administrador = await env.DB.prepare(
    "SELECT senha_hash, role, status FROM vendedores WHERE id = ?"
  ).bind(user.vendedorId).first();
  return !!administrador && administrador.role === "admin" &&
    administrador.status !== "inativo" && senha === administrador.senha_hash;
}

async function atualizarVisitaAdmin(request, env, user, id) {
  try {
    if (user.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);
    if (!idVisitaValido(id)) return json({ error: "ID de visita inválido." }, 400);

    let dados;
    try {
      dados = await request.json();
    } catch {
      return json({ error: "Corpo JSON inválido." }, 400);
    }

    const visita = await env.DB.prepare("SELECT id, comprou, status_registro FROM visitas WHERE id = ?").bind(id).first();
    if (!visita) return json({ error: "Visita não encontrada." }, 404);
    if (visita.status_registro === "CANCELADA") return json({ error: "Venda cancelada não pode ser alterada." }, 409);

    const dataVisita = normalizeText(dados.data_visita);
    const observacoes = normalizeText(dados.observacoes);
    const formaPagamento = normalizeText(dados.forma_pagamento || "não informado");
    const desconto = Number(dados.desconto);
    const recebidoInformado = Number(dados.valor_recebido);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVisita)) return json({ error: "Data da visita inválida." }, 400);
    if (!Number.isFinite(desconto) || desconto < 0) return json({ error: "Desconto inválido." }, 400);
    if (!Number.isFinite(recebidoInformado) || recebidoInformado < 0) return json({ error: "Valor recebido inválido." }, 400);

    const totalItens = await env.DB.prepare(
      "SELECT COALESCE(SUM(subtotal), 0) AS subtotal FROM visita_itens WHERE visita_id = ?"
    ).bind(id).first();
    const subtotal = visita.comprou === "sim" ? Number(totalItens?.subtotal || 0) : 0;
    if (desconto > subtotal) return json({ error: "O desconto não pode superar o subtotal." }, 400);

    const valorTotal = subtotal - desconto;
    const valorRecebido = Math.min(recebidoInformado, valorTotal);
    const situacaoCalculada = valorTotal === 0 ? "sem_venda" :
      valorRecebido >= valorTotal ? "pago" : valorRecebido > 0 ? "parcial" : "pendente";
    const situacaoInformada = normalizeText(dados.situacao_pagamento);
    const situacoesPermitidas = ["pago", "parcial", "pendente", "sem_venda"];
    if (situacaoInformada && !situacoesPermitidas.includes(situacaoInformada)) {
      return json({ error: "Situação de pagamento inválida." }, 400);
    }
    const situacaoPagamento = situacaoInformada || situacaoCalculada;

    await env.DB.prepare(`
      UPDATE visitas
      SET data_visita = ?, observacoes = ?, forma_pagamento = ?, valor_recebido = ?,
        desconto = ?, situacao_pagamento = ?, valor_total = ?
      WHERE id = ?
    `).bind(dataVisita, observacoes, formaPagamento, valorRecebido,
      desconto, situacaoPagamento, valorTotal, id).run();

    const atualizada = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
    return json({ ok: true, mensagem: "Visita atualizada.", visita: atualizada });
  } catch (err) {
    return json({ error: "Erro ao atualizar visita.", detalhe: err?.message || String(err) }, 500);
  }
}

async function validarSaidaVendaParaCancelamento(env, visita) {
  const [itensResultado, operacoesResultado] = await Promise.all([
    env.DB.prepare("SELECT * FROM visita_itens WHERE visita_id = ? ORDER BY id").bind(visita.id).all(),
    env.DB.prepare(`SELECT * FROM estoque_operacoes
      WHERE tipo = 'SAIDA_VENDA' AND origem_tipo = 'VENDA' AND origem_id = ? ORDER BY id`).bind(visita.id).all(),
  ]);
  const itens = itensResultado.results || [], operacoes = operacoesResultado.results || [];
  if (operacoes.length > 1) return { erro: "A venda possui mais de uma SAIDA_VENDA." };
  if (!operacoes.length) {
    if (["CONFIRMADO", "DIVERGENTE", "ESTORNADO"].includes(visita.estoque_status)) {
      return { erro: "A venda indica baixa de estoque, mas a operação não foi encontrada." };
    }
    return { operacao: null, movimentos: [], itens };
  }
  const operacao = operacoes[0];
  if (operacao.status !== "CONFIRMADA") return { erro: "A SAIDA_VENDA não está CONFIRMADA." };
  const movimentosResultado = await env.DB.prepare(`SELECT movimento.*, local.tipo AS local_tipo,
    local.vendedor_id AS local_vendedor_id, carga.vendedor_id AS carga_vendedor_id,
    carga.local_carga_id
    FROM estoque_movimentacoes movimento
    INNER JOIN estoque_locais local ON local.id = movimento.local_id
    LEFT JOIN estoque_cargas carga ON carga.id = movimento.carga_id
    WHERE movimento.operacao_id = ? ORDER BY movimento.id`).bind(operacao.id).all();
  const movimentos = movimentosResultado.results || [];
  if (movimentos.length !== itens.length) return { erro: "A saída de estoque está parcial em relação aos itens da venda." };
  for (const item of itens) {
    const movimento = movimentos.find(m => Number(m.visita_item_id) === Number(item.id));
    if (!movimento || Number(movimento.visita_id) !== Number(visita.id) || Number(movimento.produto_id) !== Number(item.produto_id)
      || Number(movimento.quantidade) !== Number(item.quantidade) || Number(movimento.efeito) !== -1) {
      return { erro: `Movimento incompatível com o item #${item.id}.` };
    }
    if (visita.canal_venda === "ROTA") {
      const cargaItem = await env.DB.prepare(`SELECT id FROM estoque_carga_itens
        WHERE id = ? AND carga_id = ? AND produto_id = ?`).bind(movimento.carga_item_id, movimento.carga_id, item.produto_id).first();
      if (!movimento.carga_id || !cargaItem || movimento.local_tipo !== "CARGA_VENDEDOR"
        || Number(movimento.local_vendedor_id) !== Number(visita.vendedor_id)
        || Number(movimento.carga_vendedor_id) !== Number(visita.vendedor_id)
        || Number(movimento.local_carga_id) !== Number(movimento.local_id)) {
        return { erro: `Local ou carga incompatível no item #${item.id}.` };
      }
    } else if (visita.canal_venda === "LOJA_FABRICA") {
      if (movimento.local_tipo !== "CENTRAL" || movimento.carga_id || movimento.carga_item_id) {
        return { erro: `Local central incompatível no item #${item.id}.` };
      }
    } else return { erro: "Canal da venda incompatível com a saída de estoque." };
  }
  return { operacao, movimentos, itens };
}

async function auditarCancelamentoVenda(env, visitaId, chaveCancelamento, operacaoOriginal) {
  const visita = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(visitaId).first();
  if (!visita || visita.status_registro !== "CANCELADA" || visita.chave_cancelamento !== chaveCancelamento) {
    return { mensagem: "A venda não foi reivindicada pelo cancelamento esperado." };
  }
  if (!operacaoOriginal) return null;
  const original = await env.DB.prepare("SELECT * FROM estoque_operacoes WHERE id = ?").bind(operacaoOriginal.id).first();
  const estornos = await env.DB.prepare(`SELECT * FROM estoque_operacoes
    WHERE operacao_estornada_id = ? AND tipo = 'ESTORNO'`).bind(operacaoOriginal.id).all();
  if (original?.status !== "ESTORNADA" || (estornos.results || []).length !== 1
    || estornos.results[0].status !== "CONFIRMADA" || visita.estoque_status !== "ESTORNADO") {
    return { mensagem: "Cabeçalho do estorno ou estado final da venda está inválido." };
  }
  const [originais, inversos] = await Promise.all([
    env.DB.prepare("SELECT * FROM estoque_movimentacoes WHERE operacao_id = ? ORDER BY id").bind(original.id).all(),
    env.DB.prepare("SELECT * FROM estoque_movimentacoes WHERE operacao_id = ? ORDER BY id").bind(estornos.results[0].id).all(),
  ]);
  if ((originais.results || []).length !== (inversos.results || []).length) return { mensagem: "Estorno com quantidade incorreta de movimentos." };
  for (const movimento of originais.results || []) {
    const inverso = (inversos.results || []).find(item => Number(item.local_id) === Number(movimento.local_id)
      && Number(item.produto_id) === Number(movimento.produto_id) && Number(item.carga_id || 0) === Number(movimento.carga_id || 0)
      && Number(item.carga_item_id || 0) === Number(movimento.carga_item_id || 0)
      && Number(item.visita_id) === Number(movimento.visita_id) && Number(item.visita_item_id) === Number(movimento.visita_item_id)
      && Number(item.quantidade) === Number(movimento.quantidade) && Number(item.efeito) === -Number(movimento.efeito));
    if (!inverso) return { mensagem: `Movimento #${movimento.id} não possui inverso integral.` };
  }
  return null;
}

async function excluirVisitaAdmin(request, env, user, id) {
  try {
    if (user.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);
    if (!idVisitaValido(id)) return json({ error: "ID de visita inválido." }, 400);

    let dados;
    try {
      dados = await request.json();
    } catch {
      return json({ error: "Corpo JSON inválido." }, 400);
    }
    if (!normalizeText(dados.senha)) return json({ error: "Informe a senha atual do administrador." }, 400);
    if (dados.confirmacao !== "CANCELAR") return json({ error: "Digite CANCELAR para confirmar." }, 400);
    const motivo = normalizeText(dados.motivo_cancelamento);
    const chaveCancelamento = normalizeText(dados.chave_idempotencia || dados.chave_cancelamento);
    if (!motivo || motivo.length > 500) return json({ error: "Informe o motivo do cancelamento." }, 400);
    if (!chaveCancelamento || chaveCancelamento.length > 180) return json({ error: "Chave de idempotência do cancelamento inválida." }, 400);

    const visita = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
    if (!visita) return json({ error: "Visita não encontrada." }, 404);
    if (!await confirmarSenhaAdministrador(env, user, dados.senha)) {
      return json({ error: "Senha do administrador inválida." }, 401);
    }

    if (visita.status_registro === "CANCELADA") {
      if (visita.chave_cancelamento === chaveCancelamento && normalizeText(visita.motivo_cancelamento) === motivo) {
        const originalExistente = await env.DB.prepare(`SELECT * FROM estoque_operacoes
          WHERE tipo = 'SAIDA_VENDA' AND origem_tipo = 'VENDA' AND origem_id = ?`).bind(id).first();
        const auditoriaExistente = await auditarCancelamentoVenda(env, id, chaveCancelamento, originalExistente || null);
        if (auditoriaExistente) return json({ error: "Falha crítica de auditoria do cancelamento existente.", detalhe: auditoriaExistente.mensagem }, 500);
        return json({ ok: true, idempotente: true, mensagem: "Venda já estava cancelada.", visita_id: id });
      }
      return json({ error: "A venda já foi cancelada com outra chave ou motivo." }, 409);
    }
    const validacaoSaida = await validarSaidaVendaParaCancelamento(env, visita);
    if (validacaoSaida.erro) return json({ error: "Cancelamento bloqueado: saída de estoque incoerente. Solicite auditoria.", detalhe: validacaoSaida.erro }, 409);
    const operacao = validacaoSaida.operacao, movimentos = validacaoSaida.movimentos;
    const chaveOperacaoEstorno = `CANCELAMENTO_VENDA:${chaveCancelamento}`;
    const estoqueStatusCancelado = operacao ? "ESTORNADO" : visita.estoque_status;
    const estoqueMotivoCancelado = !operacao && visita.estoque_status === "SEM_BAIXA" ? "CANCELADA_SEM_MOVIMENTACAO" : visita.estoque_motivo;
    const statements = [env.DB.prepare(`UPDATE visitas SET status_registro = 'CANCELADA', estoque_status = ?, estoque_motivo = ?,
      cancelada_em = CURRENT_TIMESTAMP, cancelada_por = ?, motivo_cancelamento = ?, chave_cancelamento = ?
      WHERE id = ? AND status_registro = 'ATIVA' AND chave_cancelamento IS NULL`)
      .bind(estoqueStatusCancelado, estoqueMotivoCancelado, user.vendedorId, motivo, chaveCancelamento, id)];
    if (operacao && operacao.status === "CONFIRMADA") {
      statements.push(env.DB.prepare(`INSERT INTO estoque_operacoes
        (tipo, status, data_operacao, origem_tipo, origem_id, chave_idempotencia,
         operacao_estornada_id, usuario_id, observacao, created_at)
        SELECT 'ESTORNO', 'CONFIRMADA', ?, 'VENDA', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        FROM visitas WHERE id = ? AND status_registro = 'CANCELADA' AND chave_cancelamento = ?`)
        .bind(obterDataLocalCuiaba(), id, chaveOperacaoEstorno, operacao.id, user.vendedorId,
          `Cancelamento da venda #${id}: ${motivo}`, id, chaveCancelamento));
      for (const movimento of movimentos) statements.push(env.DB.prepare(`INSERT INTO estoque_movimentacoes
        (operacao_id, local_id, produto_id, carga_id, carga_item_id, visita_id, visita_item_id, quantidade, efeito, created_at)
        VALUES (COALESCE((SELECT estorno.id FROM estoque_operacoes estorno
          INNER JOIN visitas visita ON visita.id = estorno.origem_id
          WHERE estorno.chave_idempotencia = ? AND visita.id = ?
            AND visita.status_registro = 'CANCELADA' AND visita.chave_cancelamento = ?), 0),
          ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(chaveOperacaoEstorno, id, chaveCancelamento,
          movimento.local_id, movimento.produto_id, movimento.carga_id, movimento.carga_item_id,
          movimento.visita_id, movimento.visita_item_id, movimento.quantidade, -Number(movimento.efeito)));
      statements.push(env.DB.prepare(`UPDATE estoque_operacoes SET status = 'ESTORNADA'
        WHERE id = ? AND status = 'CONFIRMADA' AND EXISTS (
          SELECT 1 FROM visitas WHERE id = ? AND status_registro = 'CANCELADA' AND chave_cancelamento = ?
        )`).bind(operacao.id, id, chaveCancelamento));
      statements.push(env.DB.prepare(`UPDATE visitas SET estoque_status = CASE WHEN
        status_registro = 'CANCELADA' AND chave_cancelamento = ?
        AND (SELECT COUNT(*) FROM estoque_operacoes WHERE operacao_estornada_id = ? AND tipo = 'ESTORNO' AND status = 'CONFIRMADA') = 1
        AND (SELECT COUNT(*) FROM estoque_movimentacoes WHERE operacao_id = ?) =
            (SELECT COUNT(*) FROM estoque_movimentacoes movimento INNER JOIN estoque_operacoes estorno ON estorno.id = movimento.operacao_id WHERE estorno.operacao_estornada_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM estoque_movimentacoes original
          LEFT JOIN estoque_movimentacoes inverso ON inverso.operacao_id = (SELECT id FROM estoque_operacoes WHERE operacao_estornada_id = ?)
            AND inverso.local_id = original.local_id AND inverso.produto_id = original.produto_id
            AND COALESCE(inverso.carga_id, 0) = COALESCE(original.carga_id, 0)
            AND COALESCE(inverso.carga_item_id, 0) = COALESCE(original.carga_item_id, 0)
            AND inverso.visita_id = original.visita_id AND inverso.visita_item_id = original.visita_item_id
            AND inverso.quantidade = original.quantidade AND inverso.efeito = -original.efeito
          WHERE original.operacao_id = ? AND inverso.id IS NULL
        ) THEN 'ESTORNADO' ELSE 'ESTRUTURA_INVALIDA' END
        WHERE id = ?`).bind(chaveCancelamento, operacao.id, operacao.id, operacao.id, operacao.id, operacao.id, id));
    } else {
      statements.push(env.DB.prepare(`UPDATE visitas SET estoque_status = CASE WHEN
        status_registro = 'CANCELADA' AND chave_cancelamento = ? THEN estoque_status ELSE 'ESTRUTURA_INVALIDA' END
        WHERE id = ?`).bind(chaveCancelamento, id));
    }
    try { await env.DB.batch(statements); }
    catch (err) {
      const concorrente = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
      if (concorrente?.status_registro === "CANCELADA" && concorrente.chave_cancelamento === chaveCancelamento
        && normalizeText(concorrente.motivo_cancelamento) === motivo) {
        const auditoriaConcorrente = await auditarCancelamentoVenda(env, id, chaveCancelamento, operacao);
        if (auditoriaConcorrente) return json({ error: "Falha crítica de auditoria do cancelamento concorrente.", detalhe: auditoriaConcorrente.mensagem }, 500);
        return json({ ok: true, idempotente: true, mensagem: "Venda já estava cancelada.", visita_id: id });
      }
      if (String(err?.message || "").includes("UNIQUE constraint failed")) return json({ error: "A chave de cancelamento já foi utilizada." }, 409);
      throw err;
    }
    const auditoriaCancelamento = await auditarCancelamentoVenda(env, id, chaveCancelamento, operacao);
    if (auditoriaCancelamento) return json({ error: "Falha crítica de auditoria após cancelar a venda.", detalhe: auditoriaCancelamento.mensagem }, 500);
    return json({ ok: true, idempotente: false, mensagem: "Venda cancelada e histórico preservado.", visita_id: id,
      estoque_estornado: !!operacao });
  } catch (err) {
    return json({ error: "Erro ao excluir visita.", detalhe: err?.message || String(err) }, 500);
  }
}

async function listarVendasSemBaixa(request, env, user) {
  if (!usuarioTemRole(user, "admin", "operacao")) return acessoNegado();
  const resultado = await env.DB.prepare(`SELECT v.id, v.data_visita, v.canal_venda, v.estoque_status, v.estoque_motivo,
    v.valor_total, v.observacoes, vd.nome AS vendedor_nome,
    COALESCE(c.nome_fantasia, c.razao_social, ca.nome_estabelecimento, 'Consumidor') AS cliente_nome
    FROM visitas v
    LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN clientes_avulsos ca ON ca.id = v.cliente_avulso_id
    WHERE v.status_registro = 'ATIVA' AND v.estoque_status = 'SEM_BAIXA'
    ORDER BY v.data_visita DESC, v.id DESC LIMIT 500`).all();
  return json(resultado.results || []);
}

async function conciliarVendaSemBaixa(request, env, user, id) {
  if (!usuarioTemRole(user, "admin", "operacao")) return acessoNegado();
  if (!idVisitaValido(id)) return json({ error: "ID de venda inválido." }, 400);
  const dados = await request.json(), motivo = normalizeText(dados.motivo), chave = normalizeText(dados.chave_idempotencia);
  if (!motivo || motivo.length > 500) return json({ error: "Informe o motivo da conciliação." }, 400);
  if (!chave || chave.length > 180) return json({ error: "Chave de idempotência da conciliação inválida." }, 400);
  const visita = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
  if (!visita) return json({ error: "Venda não encontrada." }, 404);
  if (visita.estoque_status === "CONCILIADO") {
    if (visita.chave_conciliacao === chave && normalizeText(visita.estoque_conciliacao_motivo) === motivo) {
      return json({ success: true, idempotente: true, visita_id: id, estoque_status: "CONCILIADO" });
    }
    return json({ error: "A venda já foi conciliada com outra chave ou motivo." }, 409);
  }
  if (visita.status_registro !== "ATIVA" || visita.estoque_status !== "SEM_BAIXA") {
    return json({ error: "Somente venda ativa com estoque SEM_BAIXA pode ser conciliada." }, 409);
  }
  try {
    const resultado = await env.DB.prepare(`UPDATE visitas SET estoque_status = 'CONCILIADO',
      estoque_conciliado_em = CURRENT_TIMESTAMP, estoque_conciliado_por = ?,
      estoque_conciliacao_motivo = ?, chave_conciliacao = ?
      WHERE id = ? AND status_registro = 'ATIVA' AND estoque_status = 'SEM_BAIXA'`)
      .bind(user.vendedorId, motivo, chave, id).run();
    if (Number(resultado.meta?.changes || 0) !== 1) return json({ error: "A situação da venda mudou durante a conciliação." }, 409);
  } catch (err) {
    const concorrente = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
    if (concorrente?.estoque_status === "CONCILIADO" && concorrente.chave_conciliacao === chave
      && normalizeText(concorrente.estoque_conciliacao_motivo) === motivo) {
      return json({ success: true, idempotente: true, visita_id: id, estoque_status: "CONCILIADO" });
    }
    if (String(err?.message || "").includes("UNIQUE constraint failed")) return json({ error: "A chave de conciliação já foi utilizada." }, 409);
    throw err;
  }
  return json({ success: true, idempotente: false, visita_id: id, estoque_status: "CONCILIADO",
    aviso: "Conciliação registrada sem baixa retroativa. A correção física deve ser feita por ajuste auditável." });
}

function acessoProducaoPermitido(user) {
  return usuarioTemRole(user, "admin", "operacao");
}

function arredondarMoeda(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

async function listarParametrosProducao(env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const resultado = await env.DB.prepare(`
    SELECT
      p.id AS produto_id,
      p.nome AS produto_nome,
      parametro.pacotes_por_fardo,
      parametro.valor_por_pacote,
      parametro.ativo AS parametro_ativo,
      parametro.updated_at AS parametro_atualizado_em
    FROM produtos p
    LEFT JOIN producao_parametros_produto parametro
      ON parametro.produto_id = p.id
    WHERE p.ativo = 'ativo'
    ORDER BY p.nome
  `).all();

  return json(resultado.results || []);
}

async function salvarParametroProducao(request, env, user, produtoId) {
  if (!usuarioTemRole(user, "admin")) return acessoNegado();
  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Produto inválido." }, 400);

  const dados = await request.json();
  const pacotesPorFardo = Number(dados.pacotes_por_fardo);
  const valorPorPacote = Number(dados.valor_por_pacote);
  const ativo = dados.ativo === false || dados.ativo === 0 || dados.ativo === "0" ? 0 : 1;

  if (!Number.isInteger(pacotesPorFardo) || pacotesPorFardo <= 0) {
    return json({ error: "Pacotes por fardo deve ser um número inteiro maior que zero." }, 400);
  }
  if (!Number.isFinite(valorPorPacote) || valorPorPacote < 0) {
    return json({ error: "Valor por pacote deve ser maior ou igual a zero." }, 400);
  }

  const produto = await env.DB.prepare(`
    SELECT id, nome FROM produtos
    WHERE id = ? AND ativo = 'ativo'
  `).bind(produtoId).first();
  if (!produto) return json({ error: "Produto ativo não encontrado." }, 404);

  await env.DB.prepare(`
    INSERT INTO producao_parametros_produto (
      produto_id, pacotes_por_fardo, valor_por_pacote, ativo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(produto_id) DO UPDATE SET
      pacotes_por_fardo = excluded.pacotes_por_fardo,
      valor_por_pacote = excluded.valor_por_pacote,
      ativo = excluded.ativo,
      updated_at = CURRENT_TIMESTAMP
  `).bind(produtoId, pacotesPorFardo, valorPorPacote, ativo).run();

  const parametro = await env.DB.prepare(`
    SELECT id, produto_id, pacotes_por_fardo, valor_por_pacote, ativo, created_at, updated_at
    FROM producao_parametros_produto WHERE produto_id = ?
  `).bind(produtoId).first();

  return json({ success: true, produto, parametro });
}

async function buscarRegistroProducaoPorChave(env, chave) {
  return env.DB.prepare(`
    SELECT * FROM producao_registros WHERE chave_idempotencia = ?
  `).bind(chave).first();
}

async function buscarEntradaEstoqueDaProducao(env, producaoId) {
  return env.DB.prepare(`
    SELECT
      o.id AS operacao_id, o.tipo, o.status, o.data_operacao,
      o.origem_tipo, o.origem_id, o.chave_idempotencia,
      m.id AS movimentacao_id, m.local_id, m.produto_id,
      m.quantidade, m.efeito
    FROM estoque_operacoes o
    INNER JOIN estoque_movimentacoes m ON m.operacao_id = o.id
    WHERE o.tipo = 'ENTRADA_PRODUCAO'
      AND o.origem_tipo = 'PRODUCAO'
      AND o.origem_id = ?
      AND o.chave_idempotencia = 'PRODUCAO:' || CAST(? AS TEXT)
    LIMIT 1
  `).bind(producaoId, producaoId).first();
}

async function registrarProducao(request, env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const dados = await request.json();
  const produtoId = Number(dados.produto_id || 0);
  const quantidadeFardos = Number(dados.quantidade_fardos);
  const dataProducao = normalizeText(dados.data_producao || obterDataLocalCuiaba());
  const observacao = normalizeText(dados.observacao);
  const chaveRecebida = normalizeText(dados.chave_idempotencia);

  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Selecione um produto válido." }, 400);
  if (!Number.isInteger(quantidadeFardos) || quantidadeFardos <= 0) {
    return json({ error: "A quantidade de fardos concluídos deve ser um número inteiro maior que zero." }, 400);
  }
  if (!dataOperacionalValida(dataProducao)) return json({ error: "Data da produção inválida." }, 400);
  if (!chaveRecebida || chaveRecebida.length > 180) return json({ error: "Chave de idempotência inválida." }, 400);

  const produto = await env.DB.prepare(`
    SELECT
      p.id, p.nome,
      parametro.pacotes_por_fardo,
      parametro.valor_por_pacote
    FROM produtos p
    INNER JOIN producao_parametros_produto parametro
      ON parametro.produto_id = p.id AND parametro.ativo = 1
    WHERE p.id = ? AND p.ativo = 'ativo'
  `).bind(produtoId).first();
  if (!produto) return json({ error: "Produto ativo sem parâmetros de produção ativos." }, 409);

  const pacotesPorFardo = Number(produto.pacotes_por_fardo);
  const valorPorPacote = Number(produto.valor_por_pacote);
  if (!Number.isInteger(pacotesPorFardo) || pacotesPorFardo <= 0 || !Number.isFinite(valorPorPacote) || valorPorPacote < 0) {
    return json({ error: "Parâmetros de produção inválidos." }, 409);
  }

  const quantidadePacotes = quantidadeFardos * pacotesPorFardo;
  const valorProducao = arredondarMoeda(quantidadePacotes * valorPorPacote);
  const chave = `PRODUCAO:${chaveRecebida}`;
  const local = await obterEstoqueCentral(env);
  if (!local) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);

  const existente = await buscarRegistroProducaoPorChave(env, chave);
  if (existente) {
    const entradaEstoque = await buscarEntradaEstoqueDaProducao(env, existente.id);
    if (!entradaEstoque) {
      return json({
        error: "A produção já existe, mas sua entrada de estoque não foi encontrada. Solicite auditoria antes de repetir a operação.",
        producao_id: existente.id,
      }, 409);
    }
    return json({ success: true, idempotente: true, registro: existente, entrada_estoque: entradaEstoque });
  }

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO producao_registros (
          produto_id, usuario_id, data_producao, quantidade_fardos,
          pacotes_por_fardo_snapshot, quantidade_pacotes,
          valor_por_pacote_snapshot, valor_producao,
          observacao, chave_idempotencia, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        produtoId, user.vendedorId, dataProducao, quantidadeFardos,
        pacotesPorFardo, quantidadePacotes, valorPorPacote, valorProducao,
        observacao || null, chave
      ),
      env.DB.prepare(`
        INSERT INTO estoque_operacoes (
          tipo, status, data_operacao, origem_tipo, origem_id,
          chave_idempotencia, operacao_estornada_id, usuario_id,
          observacao, created_at
        )
        SELECT
          'ENTRADA_PRODUCAO', 'CONFIRMADA', data_producao, 'PRODUCAO', id,
          'PRODUCAO:' || CAST(id AS TEXT), NULL, usuario_id,
          'Entrada automática da Produção #' || CAST(id AS TEXT),
          CURRENT_TIMESTAMP
        FROM producao_registros
        WHERE chave_idempotencia = ?
      `).bind(chave),
      env.DB.prepare(`
        INSERT INTO estoque_movimentacoes (
          operacao_id, local_id, produto_id, carga_id, carga_item_id,
          visita_id, visita_item_id, quantidade, efeito, created_at
        )
        SELECT
          o.id, ?, r.produto_id, NULL, NULL, NULL, NULL,
          r.quantidade_fardos, 1, CURRENT_TIMESTAMP
        FROM producao_registros r
        INNER JOIN estoque_operacoes o
          ON o.origem_tipo = 'PRODUCAO'
          AND o.origem_id = r.id
          AND o.chave_idempotencia = 'PRODUCAO:' || CAST(r.id AS TEXT)
        WHERE r.chave_idempotencia = ?
      `).bind(local.id, chave),
    ]);
  } catch (err) {
    const concorrente = await buscarRegistroProducaoPorChave(env, chave);
    if (concorrente) {
      const entradaConcorrente = await buscarEntradaEstoqueDaProducao(env, concorrente.id);
      if (entradaConcorrente) {
        return json({ success: true, idempotente: true, registro: concorrente, entrada_estoque: entradaConcorrente });
      }
    }
    throw err;
  }

  const registro = await buscarRegistroProducaoPorChave(env, chave);
  const entradaEstoque = await buscarEntradaEstoqueDaProducao(env, registro.id);
  if (!entradaEstoque) throw new Error("A transação não confirmou a entrada da produção no estoque.");

  return json({
    success: true,
    idempotente: false,
    registro,
    entrada_estoque: entradaEstoque,
    produto: { id: produto.id, nome: produto.nome },
  }, 201);
}

async function listarRegistrosProducao(request, env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const url = new URL(request.url);
  const produtoId = Number(url.searchParams.get("produto_id") || 0);
  const usuarioId = Number(url.searchParams.get("usuario_id") || 0);
  const dataInicial = normalizeText(url.searchParams.get("data_inicial"));
  const dataFinal = normalizeText(url.searchParams.get("data_final"));

  if (produtoId && (!Number.isInteger(produtoId) || produtoId <= 0)) return json({ error: "Produto inválido." }, 400);
  if (usuarioId && (!Number.isInteger(usuarioId) || usuarioId <= 0)) return json({ error: "Usuário inválido." }, 400);
  if (dataInicial && !dataOperacionalValida(dataInicial)) return json({ error: "Data inicial inválida." }, 400);
  if (dataFinal && !dataOperacionalValida(dataFinal)) return json({ error: "Data final inválida." }, 400);
  if (dataInicial && dataFinal && dataInicial > dataFinal) return json({ error: "Período inválido." }, 400);

  const filtros = ["1 = 1"];
  const parametros = [];
  if (produtoId) { filtros.push("registro.produto_id = ?"); parametros.push(produtoId); }
  if (usuarioId) { filtros.push("registro.usuario_id = ?"); parametros.push(usuarioId); }
  if (dataInicial) { filtros.push("registro.data_producao >= ?"); parametros.push(dataInicial); }
  if (dataFinal) { filtros.push("registro.data_producao <= ?"); parametros.push(dataFinal); }

  const resultado = await env.DB.prepare(`
    SELECT
      registro.id, registro.produto_id, p.nome AS produto_nome,
      registro.usuario_id, v.nome AS usuario_nome,
      registro.data_producao, registro.quantidade_fardos,
      registro.pacotes_por_fardo_snapshot, registro.quantidade_pacotes,
      registro.valor_por_pacote_snapshot, registro.valor_producao,
      registro.observacao, registro.created_at
    FROM producao_registros registro
    INNER JOIN produtos p ON p.id = registro.produto_id
    LEFT JOIN vendedores v ON v.id = registro.usuario_id
    WHERE ${filtros.join(" AND ")}
    ORDER BY registro.data_producao DESC, registro.id DESC
    LIMIT 500
  `).bind(...parametros).all();

  return json(resultado.results || []);
}

function chaveLoteProducao(chaveCliente) {
  return `LOTE_PRODUCAO:${chaveCliente}`;
}

function chaveItemLoteProducao(chaveCliente, produtoId) {
  return `LOTE_PRODUCAO:${chaveCliente}:PRODUTO:${produtoId}`;
}

async function listarReceitasBaseProducao(env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const resultado = await env.DB.prepare(`
    SELECT id, nome, versao, ativo, created_at, updated_at
    FROM producao_receitas_base
    WHERE ativo = 1
    ORDER BY nome, versao DESC
  `).all();

  return json(resultado.results || []);
}

async function buscarLoteProducaoPorChave(env, chave) {
  return env.DB.prepare(`
    SELECT
      lote.id, lote.receita_base_id, receita.nome AS receita_base_nome,
      receita.versao AS receita_base_versao,
      lote.quantidade_receitas_base, lote.data_producao,
      lote.usuario_id, usuario.nome AS usuario_nome,
      lote.observacao, lote.chave_idempotencia, lote.created_at,
      lote.fluxo, lote.status, lote.encerrado_em, lote.encerrado_por,
      lote.chave_encerramento, lote.motivo_encerramento
    FROM producao_lotes lote
    INNER JOIN producao_receitas_base receita ON receita.id = lote.receita_base_id
    LEFT JOIN vendedores usuario ON usuario.id = lote.usuario_id
    WHERE lote.chave_idempotencia = ?
  `).bind(chave).first();
}

async function buscarLoteProducaoPorId(env, loteId) {
  return env.DB.prepare(`
    SELECT
      lote.id, lote.receita_base_id, receita.nome AS receita_base_nome,
      receita.versao AS receita_base_versao,
      lote.quantidade_receitas_base, lote.data_producao,
      lote.usuario_id, usuario.nome AS usuario_nome,
      lote.observacao, lote.chave_idempotencia, lote.created_at,
      lote.fluxo, lote.status, lote.encerrado_em, lote.encerrado_por,
      lote.chave_encerramento, lote.motivo_encerramento
    FROM producao_lotes lote
    INNER JOIN producao_receitas_base receita ON receita.id = lote.receita_base_id
    LEFT JOIN vendedores usuario ON usuario.id = lote.usuario_id
    WHERE lote.id = ?
  `).bind(loteId).first();
}

async function carregarItensLoteProducao(env, loteId) {
  const resultado = await env.DB.prepare(`
    SELECT
      registro.id, registro.lote_id, registro.produto_id,
      produto.nome AS produto_nome,
      registro.usuario_id, usuario.nome AS usuario_nome,
      registro.data_producao,
      registro.quantidade_fardos,
      registro.pacotes_por_fardo_snapshot,
      registro.quantidade_pacotes,
      registro.valor_por_pacote_snapshot,
      registro.valor_producao,
      registro.observacao,
      registro.chave_idempotencia,
      registro.created_at,
      (
        SELECT COUNT(*)
        FROM estoque_operacoes operacao_contagem
        WHERE operacao_contagem.tipo = 'ENTRADA_PRODUCAO'
          AND operacao_contagem.origem_tipo = 'PRODUCAO'
          AND operacao_contagem.origem_id = registro.id
      ) AS total_operacoes_estoque,
      (
        SELECT operacao.id
        FROM estoque_operacoes operacao
        WHERE operacao.tipo = 'ENTRADA_PRODUCAO'
          AND operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
          AND operacao.chave_idempotencia =
            'PRODUCAO:' || CAST(registro.id AS TEXT)
        LIMIT 1
      ) AS operacao_estoque_id,
      (
        SELECT COUNT(*)
        FROM estoque_movimentacoes movimento_contagem
        INNER JOIN estoque_operacoes operacao_contagem
          ON operacao_contagem.id = movimento_contagem.operacao_id
        WHERE operacao_contagem.tipo = 'ENTRADA_PRODUCAO'
          AND operacao_contagem.origem_tipo = 'PRODUCAO'
          AND operacao_contagem.origem_id = registro.id
      ) AS total_movimentacoes_estoque,
      (
        SELECT movimento.id
        FROM estoque_movimentacoes movimento
        INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
        WHERE operacao.tipo = 'ENTRADA_PRODUCAO'
          AND operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
          AND operacao.chave_idempotencia =
            'PRODUCAO:' || CAST(registro.id AS TEXT)
        LIMIT 1
      ) AS movimentacao_estoque_id,
      (
        SELECT movimento.local_id
        FROM estoque_movimentacoes movimento
        INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
        WHERE operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
        LIMIT 1
      ) AS estoque_local_id,
      (
        SELECT movimento.produto_id
        FROM estoque_movimentacoes movimento
        INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
        WHERE operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
        LIMIT 1
      ) AS estoque_produto_id,
      (
        SELECT movimento.quantidade
        FROM estoque_movimentacoes movimento
        INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
        WHERE operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
        LIMIT 1
      ) AS estoque_quantidade,
      (
        SELECT movimento.efeito
        FROM estoque_movimentacoes movimento
        INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
        WHERE operacao.origem_tipo = 'PRODUCAO'
          AND operacao.origem_id = registro.id
        LIMIT 1
      ) AS estoque_efeito
    FROM producao_registros registro
    INNER JOIN produtos produto ON produto.id = registro.produto_id
    LEFT JOIN vendedores usuario ON usuario.id = registro.usuario_id
    WHERE registro.lote_id = ?
    ORDER BY registro.id
  `).bind(loteId).all();

  return resultado.results || [];
}

async function carregarLoteProducaoCompleto(env, identificador, porChave = false) {
  const lote = porChave
    ? await buscarLoteProducaoPorChave(env, identificador)
    : await buscarLoteProducaoPorId(env, identificador);
  if (!lote) return null;
  const itens = await carregarItensLoteProducao(env, lote.id);
  const vinculados = await env.DB.prepare(`
    SELECT vinculo.id, vinculo.lote_id, vinculo.produto_id,
      produto.nome AS produto_nome,
      vinculo.pacotes_por_fardo_snapshot,
      vinculo.valor_por_pacote_snapshot,
      vinculo.incluido_por, usuario.nome AS incluido_por_nome,
      vinculo.observacao, vinculo.chave_idempotencia, vinculo.created_at
    FROM producao_lote_produtos vinculo
    INNER JOIN produtos produto ON produto.id = vinculo.produto_id
    LEFT JOIN vendedores usuario ON usuario.id = vinculo.incluido_por
    WHERE vinculo.lote_id = ?
    ORDER BY vinculo.created_at, vinculo.id
  `).bind(lote.id).all();
  return { ...lote, itens, produtos_vinculados: vinculados.results || [] };
}

function compararNumeroProducao(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.00001;
}

function validarLoteExistenteContraPayload(lote, esperado, localId) {
  if (
    Number(lote.receita_base_id) !== esperado.receitaBaseId
    || !compararNumeroProducao(lote.quantidade_receitas_base, esperado.quantidadeReceitasBase)
    || lote.data_producao !== esperado.dataProducao
    || Number(lote.usuario_id) !== esperado.usuarioId
    || normalizeText(lote.observacao) !== esperado.observacao
  ) {
    return { tipo: "DIVERGENTE", mensagem: "A chave de idempotência já foi utilizada com dados diferentes." };
  }

  if (lote.itens.length !== esperado.itens.length) {
    return { tipo: "INCOMPLETO", mensagem: "O lote existente possui quantidade inesperada de itens." };
  }

  const itensPorProduto = new Map(lote.itens.map(item => [Number(item.produto_id), item]));
  for (const itemEsperado of esperado.itens) {
    const item = itensPorProduto.get(itemEsperado.produtoId);
    if (!item || Number(item.quantidade_fardos) !== itemEsperado.quantidadeFardos) {
      return item
        ? { tipo: "DIVERGENTE", mensagem: "O lote existente possui quantidade de fardos diferente." }
        : { tipo: "INCOMPLETO", mensagem: "O lote existente não possui todos os produtos esperados." };
    }

    const calculoIntegro = Number(item.quantidade_pacotes)
      === Number(item.quantidade_fardos) * Number(item.pacotes_por_fardo_snapshot)
      && compararNumeroProducao(
        item.valor_producao,
        arredondarMoeda(Number(item.quantidade_pacotes) * Number(item.valor_por_pacote_snapshot))
      );
    const estoqueIntegro = Number(item.total_operacoes_estoque) === 1
      && Number(item.total_movimentacoes_estoque) === 1
      && Number(item.operacao_estoque_id) > 0
      && Number(item.movimentacao_estoque_id) > 0
      && Number(item.estoque_local_id) === Number(localId)
      && Number(item.estoque_produto_id) === itemEsperado.produtoId
      && compararNumeroProducao(item.estoque_quantidade, item.quantidade_fardos)
      && Number(item.estoque_efeito) === 1;
    if (!calculoIntegro || !estoqueIntegro) {
      return { tipo: "INCOMPLETO", mensagem: "O lote existente possui Produção ou Estoque incompleto." };
    }
  }

  return null;
}

function respostaConflitoLote(validacao, lote) {
  return json({
    error: validacao.tipo === "INCOMPLETO"
      ? "O lote já existe, mas sua estrutura de Produção ou Estoque está incompleta. Solicite auditoria."
      : validacao.mensagem,
    detalhe: validacao.mensagem,
    lote_id: lote.id,
  }, 409);
}

async function registrarLoteProducao(request, env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const dados = await request.json();
  const receitaBaseId = Number(dados.receita_base_id || 0);
  const quantidadeInformada = dados.quantidade_receitas_base === null
    || dados.quantidade_receitas_base === undefined
    ? ""
    : String(dados.quantidade_receitas_base).trim();
  const quantidadeReceitasBase = quantidadeInformada === ""
    ? Number.NaN
    : Number(dados.quantidade_receitas_base);
  const dataProducao = normalizeText(dados.data_producao || obterDataLocalCuiaba());
  const observacao = normalizeText(dados.observacao);
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  const itensRecebidos = Array.isArray(dados.itens) ? dados.itens : [];

  if (!Number.isInteger(receitaBaseId) || receitaBaseId <= 0) return json({ error: "Receita Base inválida." }, 400);
  if (!Number.isFinite(quantidadeReceitasBase) || quantidadeReceitasBase <= 0) {
    return json({ error: "A quantidade de Receitas Base deve ser maior que zero." }, 400);
  }
  if (!dataOperacionalValida(dataProducao)) return json({ error: "Data da Produção inválida." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  if (!itensRecebidos.length) return json({ error: "Adicione ao menos um produto ao lote." }, 400);

  const itens = itensRecebidos.map(item => ({
    produtoId: Number(item?.produto_id || 0),
    quantidadeFardos: Number(item?.quantidade_fardos),
  }));
  if (itens.some(item => !Number.isInteger(item.produtoId) || item.produtoId <= 0)) {
    return json({ error: "Todos os itens devem possuir produto válido." }, 400);
  }
  if (itens.some(item => !Number.isInteger(item.quantidadeFardos) || item.quantidadeFardos <= 0)) {
    return json({ error: "A quantidade de fardos de cada produto deve ser um inteiro maior que zero." }, 400);
  }
  if (new Set(itens.map(item => item.produtoId)).size !== itens.length) {
    return json({ error: "O mesmo produto não pode aparecer duas vezes no lote." }, 400);
  }

  const local = await obterEstoqueCentral(env);
  if (!local) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);

  const chaveLote = chaveLoteProducao(chaveCliente);
  const esperado = {
    receitaBaseId,
    quantidadeReceitasBase,
    dataProducao,
    usuarioId: Number(user.vendedorId),
    observacao,
    itens,
  };
  const existente = await carregarLoteProducaoCompleto(env, chaveLote, true);
  if (existente) {
    const validacao = validarLoteExistenteContraPayload(existente, esperado, local.id);
    if (validacao) return respostaConflitoLote(validacao, existente);
    return json({ success: true, idempotente: true, lote: existente });
  }

  const receita = await env.DB.prepare(`
    SELECT id, nome, versao
    FROM producao_receitas_base
    WHERE id = ? AND ativo = 1
  `).bind(receitaBaseId).first();
  if (!receita) return json({ error: "Receita Base ativa não encontrada." }, 409);

  const parametros = await Promise.all(itens.map(item => env.DB.prepare(`
    SELECT produto.id, produto.nome,
      parametro.pacotes_por_fardo, parametro.valor_por_pacote
    FROM produtos produto
    INNER JOIN producao_parametros_produto parametro
      ON parametro.produto_id = produto.id AND parametro.ativo = 1
    WHERE produto.id = ? AND produto.ativo = 'ativo'
  `).bind(item.produtoId).first()));
  if (parametros.some(parametro => !parametro)) {
    return json({ error: "Todos os produtos devem estar ativos e possuir parâmetros de Produção ativos." }, 409);
  }
  if (parametros.some(parametro =>
    !Number.isInteger(Number(parametro.pacotes_por_fardo))
    || Number(parametro.pacotes_por_fardo) <= 0
    || !Number.isFinite(Number(parametro.valor_por_pacote))
    || Number(parametro.valor_por_pacote) < 0
  )) {
    return json({ error: "Existem parâmetros de Produção inválidos no lote." }, 409);
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO producao_lotes (
        receita_base_id, quantidade_receitas_base, data_producao,
        usuario_id, observacao, chave_idempotencia, created_at
      )
      SELECT receita.id, ?, ?, usuario.id, ?, ?, CURRENT_TIMESTAMP
      FROM producao_receitas_base receita
      INNER JOIN vendedores usuario ON usuario.id = ?
      WHERE receita.id = ? AND receita.ativo = 1
        AND usuario.status = 'ativo'
        AND usuario.role IN ('admin', 'operacao')
    `).bind(
      quantidadeReceitasBase, dataProducao, observacao || null,
      chaveLote, user.vendedorId, receitaBaseId
    ),
  ];

  for (const item of itens) {
    const chaveItem = chaveItemLoteProducao(chaveCliente, item.produtoId);
    statements.push(
      env.DB.prepare(`
        INSERT INTO producao_registros (
          lote_id, produto_id, usuario_id, data_producao,
          quantidade_fardos, pacotes_por_fardo_snapshot,
          quantidade_pacotes, valor_por_pacote_snapshot,
          valor_producao, observacao, chave_idempotencia, created_at
        )
        SELECT
          lote.id, produto.id, lote.usuario_id, lote.data_producao,
          ?, parametro.pacotes_por_fardo,
          ? * parametro.pacotes_por_fardo,
          parametro.valor_por_pacote,
          ROUND(? * parametro.pacotes_por_fardo * parametro.valor_por_pacote, 2),
          lote.observacao, ?, CURRENT_TIMESTAMP
        FROM producao_lotes lote
        INNER JOIN produtos produto
          ON produto.id = ? AND produto.ativo = 'ativo'
        INNER JOIN producao_parametros_produto parametro
          ON parametro.produto_id = produto.id AND parametro.ativo = 1
        WHERE lote.chave_idempotencia = ?
      `).bind(
        item.quantidadeFardos, item.quantidadeFardos, item.quantidadeFardos,
        chaveItem, item.produtoId, chaveLote
      ),
      env.DB.prepare(`
        INSERT INTO estoque_operacoes (
          tipo, status, data_operacao, origem_tipo, origem_id,
          chave_idempotencia, operacao_estornada_id, usuario_id,
          observacao, created_at
        )
        SELECT
          'ENTRADA_PRODUCAO', 'CONFIRMADA',
          COALESCE((SELECT data_producao FROM producao_registros WHERE id = alvo.registro_id), ''),
          'PRODUCAO', alvo.registro_id,
          'PRODUCAO:' || CAST(alvo.registro_id AS TEXT), NULL,
          COALESCE((SELECT usuario_id FROM producao_registros WHERE id = alvo.registro_id), 0),
          'Entrada automática da Produção #' || CAST(alvo.registro_id AS TEXT),
          CURRENT_TIMESTAMP
        FROM (
          SELECT COALESCE((
            SELECT id FROM producao_registros WHERE chave_idempotencia = ?
          ), 0) AS registro_id
        ) alvo
      `).bind(chaveItem),
      env.DB.prepare(`
        INSERT INTO estoque_movimentacoes (
          operacao_id, local_id, produto_id, carga_id, carga_item_id,
          visita_id, visita_item_id, quantidade, efeito, created_at
        ) VALUES (
          COALESCE((
            SELECT operacao.id
            FROM estoque_operacoes operacao
            INNER JOIN producao_registros registro
              ON operacao.origem_tipo = 'PRODUCAO'
              AND operacao.origem_id = registro.id
              AND operacao.chave_idempotencia =
                'PRODUCAO:' || CAST(registro.id AS TEXT)
            WHERE registro.chave_idempotencia = ?
          ), 0),
          ?,
          COALESCE((SELECT produto_id FROM producao_registros WHERE chave_idempotencia = ?), 0),
          NULL, NULL, NULL, NULL,
          COALESCE((SELECT quantidade_fardos FROM producao_registros WHERE chave_idempotencia = ?), 0),
          1,
          CURRENT_TIMESTAMP
        )
      `).bind(chaveItem, local.id, chaveItem, chaveItem)
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await carregarLoteProducaoCompleto(env, chaveLote, true);
    if (concorrente) {
      const validacao = validarLoteExistenteContraPayload(concorrente, esperado, local.id);
      if (validacao) return respostaConflitoLote(validacao, concorrente);
      return json({ success: true, idempotente: true, lote: concorrente });
    }
    throw err;
  }

  const lote = await carregarLoteProducaoCompleto(env, chaveLote, true);
  if (!lote) throw new Error("O batch não confirmou a criação do lote de Produção.");
  const validacaoFinal = validarLoteExistenteContraPayload(lote, esperado, local.id);
  if (validacaoFinal) throw new Error(`Lote criado com estrutura inválida: ${validacaoFinal.mensagem}`);

  return json({ success: true, idempotente: false, lote }, 201);
}

async function listarLotesProducao(request, env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();

  const url = new URL(request.url);
  const receitaBaseId = Number(url.searchParams.get("receita_base_id") || 0);
  const produtoId = Number(url.searchParams.get("produto_id") || 0);
  const usuarioId = Number(url.searchParams.get("usuario_id") || 0);
  const status = normalizeText(url.searchParams.get("status")).toUpperCase();
  const fluxo = normalizeText(url.searchParams.get("fluxo")).toUpperCase();
  const dataInicial = normalizeText(url.searchParams.get("data_inicial"));
  const dataFinal = normalizeText(url.searchParams.get("data_final"));

  if (receitaBaseId && (!Number.isInteger(receitaBaseId) || receitaBaseId <= 0)) return json({ error: "Receita Base inválida." }, 400);
  if (produtoId && (!Number.isInteger(produtoId) || produtoId <= 0)) return json({ error: "Produto inválido." }, 400);
  if (usuarioId && (!Number.isInteger(usuarioId) || usuarioId <= 0)) return json({ error: "Usuário inválido." }, 400);
  if (status && !new Set(["ABERTO", "ENCERRADO"]).has(status)) return json({ error: "Status de lote inválido." }, 400);
  if (fluxo && !new Set(["V1_LEGADO", "V1_1_GRADUAL"]).has(fluxo)) return json({ error: "Fluxo de lote inválido." }, 400);
  if (dataInicial && !dataOperacionalValida(dataInicial)) return json({ error: "Data inicial inválida." }, 400);
  if (dataFinal && !dataOperacionalValida(dataFinal)) return json({ error: "Data final inválida." }, 400);
  if (dataInicial && dataFinal && dataInicial > dataFinal) return json({ error: "Período inválido." }, 400);

  const filtros = ["1 = 1"];
  const parametros = [];
  if (receitaBaseId) { filtros.push("lote.receita_base_id = ?"); parametros.push(receitaBaseId); }
  if (usuarioId) { filtros.push("lote.usuario_id = ?"); parametros.push(usuarioId); }
  if (dataInicial) { filtros.push("lote.data_producao >= ?"); parametros.push(dataInicial); }
  if (dataFinal) { filtros.push("lote.data_producao <= ?"); parametros.push(dataFinal); }
  if (status) { filtros.push("lote.status = ?"); parametros.push(status); }
  if (fluxo) { filtros.push("lote.fluxo = ?"); parametros.push(fluxo); }
  if (produtoId) {
    filtros.push(`(
      EXISTS (SELECT 1 FROM producao_registros filtro_registro WHERE filtro_registro.lote_id = lote.id AND filtro_registro.produto_id = ?)
      OR EXISTS (SELECT 1 FROM producao_lote_produtos filtro_vinculo WHERE filtro_vinculo.lote_id = lote.id AND filtro_vinculo.produto_id = ?)
    )`);
    parametros.push(produtoId, produtoId);
  }

  const resultado = await env.DB.prepare(`
    SELECT
      lote.id, lote.receita_base_id, receita.nome AS receita_base_nome,
      receita.versao AS receita_base_versao,
      lote.quantidade_receitas_base, lote.data_producao,
      lote.usuario_id, usuario.nome AS usuario_nome,
      lote.observacao, lote.chave_idempotencia, lote.created_at,
      lote.fluxo, lote.status, lote.encerrado_em, lote.encerrado_por,
      lote.motivo_encerramento,
      COUNT(DISTINCT registro.produto_id) AS total_produtos,
      (SELECT COUNT(*) FROM producao_lote_produtos vinculo WHERE vinculo.lote_id = lote.id) AS total_produtos_vinculados,
      COALESCE(SUM(registro.quantidade_fardos), 0) AS total_fardos,
      COALESCE(SUM(registro.quantidade_pacotes), 0) AS total_pacotes,
      COALESCE(SUM(registro.valor_producao), 0) AS valor_producao,
      COALESCE(SUM(registro.quantidade_fardos), 0) / lote.quantidade_receitas_base AS rendimento_total_por_receita
    FROM producao_lotes lote
    INNER JOIN producao_receitas_base receita ON receita.id = lote.receita_base_id
    LEFT JOIN vendedores usuario ON usuario.id = lote.usuario_id
    LEFT JOIN producao_registros registro ON registro.lote_id = lote.id
    WHERE ${filtros.join(" AND ")}
    GROUP BY lote.id, receita.nome, receita.versao, usuario.nome
    ORDER BY lote.data_producao DESC, lote.id DESC
    LIMIT 500
  `).bind(...parametros).all();

  return json(resultado.results || []);
}

async function obterLoteProducao(env, user, loteId) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();
  if (!Number.isInteger(loteId) || loteId <= 0) return json({ error: "Lote inválido." }, 400);

  const lote = await carregarLoteProducaoCompleto(env, loteId);
  if (!lote) return json({ error: "Lote de Produção não encontrado." }, 404);
  return json(lote);
}

function chaveAberturaLoteV11(chaveCliente) {
  return `LOTE_PRODUCAO_V1_1:${chaveCliente}`;
}

function chaveLancamentoLoteV11(loteId, chaveCliente) {
  return `LANCAMENTO_PRODUCAO:${loteId}:${chaveCliente}`;
}

async function carregarVinculosAberturaV11(env, loteId, chaveCliente) {
  const resultado = await env.DB.prepare(`
    SELECT produto_id, pacotes_por_fardo_snapshot, valor_por_pacote_snapshot
    FROM producao_lote_produtos
    WHERE lote_id = ? AND chave_idempotencia LIKE ?
    ORDER BY produto_id
  `).bind(loteId, `LOTE_PRODUTO_ABERTURA:${chaveCliente}:PRODUTO:%`).all();
  return resultado.results || [];
}

function validarAberturaV11Existente(lote, vinculos, esperado) {
  if (lote.fluxo !== "V1_1_GRADUAL"
    || Number(lote.receita_base_id) !== esperado.receitaBaseId
    || !compararNumeroProducao(lote.quantidade_receitas_base, esperado.quantidadeReceitasBase)
    || lote.data_producao !== esperado.dataProducao
    || Number(lote.usuario_id) !== esperado.usuarioId
    || normalizeText(lote.observacao) !== esperado.observacao) {
    return { tipo: "DIVERGENTE", mensagem: "A chave de abertura já foi utilizada com dados diferentes." };
  }
  if (vinculos.length !== esperado.produtos.length) return { tipo: "INCOMPLETO", mensagem: "A abertura existente possui produtos incompletos." };
  const ids = new Set(vinculos.map(vinculo => Number(vinculo.produto_id)));
  if (esperado.produtos.some(produtoId => !ids.has(produtoId))) return { tipo: "DIVERGENTE", mensagem: "A abertura existente possui produtos diferentes." };
  return null;
}

async function abrirLoteProducaoV11(request, env, user) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();
  const dados = await request.json();
  const receitaBaseId = Number(dados.receita_base_id || 0);
  const quantidadeReceitasBase = Number(dados.quantidade_receitas_base);
  const dataProducao = normalizeText(dados.data_producao || obterDataLocalCuiaba());
  const observacao = normalizeText(dados.observacao);
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  const produtos = Array.isArray(dados.produtos) ? dados.produtos.map(Number) : [];
  if (!Number.isInteger(receitaBaseId) || receitaBaseId <= 0) return json({ error: "Receita Base inválida." }, 400);
  if (!Number.isFinite(quantidadeReceitasBase) || quantidadeReceitasBase <= 0) return json({ error: "A quantidade de Receitas Base deve ser maior que zero." }, 400);
  if (!dataOperacionalValida(dataProducao)) return json({ error: "Data da produção inválida." }, 400);
  if (!observacao) return json({ error: "A observação para identificação física do lote é obrigatória." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  if (!produtos.length) return json({ error: "Vincule ao menos um produto ao lote." }, 400);
  if (produtos.some(id => !Number.isInteger(id) || id <= 0)) return json({ error: "Todos os produtos devem ser válidos." }, 400);
  if (new Set(produtos).size !== produtos.length) return json({ error: "O mesmo produto não pode ser vinculado duas vezes." }, 400);

  const chaveLote = chaveAberturaLoteV11(chaveCliente);
  const esperado = { receitaBaseId, quantidadeReceitasBase, dataProducao, observacao, usuarioId: Number(user.vendedorId), produtos };
  const existente = await carregarLoteProducaoCompleto(env, chaveLote, true);
  if (existente) {
    const vinculos = await carregarVinculosAberturaV11(env, existente.id, chaveCliente);
    const validacao = validarAberturaV11Existente(existente, vinculos, esperado);
    if (validacao) return respostaConflitoLote(validacao, existente);
    return json({ success: true, idempotente: true, lote: existente });
  }

  const receita = await env.DB.prepare("SELECT id FROM producao_receitas_base WHERE id = ? AND ativo = 1").bind(receitaBaseId).first();
  if (!receita) return json({ error: "Receita Base ativa não encontrada." }, 409);
  const parametros = await Promise.all(produtos.map(produtoId => env.DB.prepare(`
    SELECT produto.id, parametro.pacotes_por_fardo, parametro.valor_por_pacote
    FROM produtos produto
    INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1
    WHERE produto.id = ? AND produto.ativo = 'ativo'
  `).bind(produtoId).first()));
  if (parametros.some(item => !item)) return json({ error: "Todos os produtos devem estar ativos e possuir parâmetros de Produção ativos." }, 409);

  const statements = [env.DB.prepare(`
    INSERT INTO producao_lotes (
      receita_base_id, quantidade_receitas_base, data_producao,
      usuario_id, observacao, chave_idempotencia, created_at,
      fluxo, status
    )
    SELECT receita.id, ?, ?, usuario.id, ?, ?, CURRENT_TIMESTAMP,
      'V1_1_GRADUAL', 'ABERTO'
    FROM producao_receitas_base receita
    INNER JOIN vendedores usuario ON usuario.id = ?
    WHERE receita.id = ? AND receita.ativo = 1
      AND usuario.status = 'ativo' AND usuario.role IN ('admin', 'operacao')
  `).bind(quantidadeReceitasBase, dataProducao, observacao, chaveLote, user.vendedorId, receitaBaseId)];
  for (const produtoId of produtos) statements.push(env.DB.prepare(`
    INSERT INTO producao_lote_produtos (
      lote_id, produto_id, pacotes_por_fardo_snapshot,
      valor_por_pacote_snapshot, incluido_por, observacao,
      chave_idempotencia, created_at
    ) VALUES (
      COALESCE((SELECT id FROM producao_lotes WHERE chave_idempotencia = ? AND fluxo = 'V1_1_GRADUAL' AND status = 'ABERTO'), 0),
      COALESCE((SELECT produto.id FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), 0),
      COALESCE((SELECT parametro.pacotes_por_fardo FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), 0),
      COALESCE((SELECT parametro.valor_por_pacote FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), -1),
      ?, 'Vinculado na abertura do lote', ?, CURRENT_TIMESTAMP
    )
  `).bind(chaveLote, produtoId, produtoId, produtoId, user.vendedorId, `LOTE_PRODUTO_ABERTURA:${chaveCliente}:PRODUTO:${produtoId}`));
  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await carregarLoteProducaoCompleto(env, chaveLote, true);
    if (concorrente) {
      const vinculos = await carregarVinculosAberturaV11(env, concorrente.id, chaveCliente);
      const validacao = validarAberturaV11Existente(concorrente, vinculos, esperado);
      if (validacao) return respostaConflitoLote(validacao, concorrente);
      return json({ success: true, idempotente: true, lote: concorrente });
    }
    throw err;
  }
  const lote = await carregarLoteProducaoCompleto(env, chaveLote, true);
  const vinculos = lote ? await carregarVinculosAberturaV11(env, lote.id, chaveCliente) : [];
  const validacao = lote ? validarAberturaV11Existente(lote, vinculos, esperado) : { tipo: "INCOMPLETO", mensagem: "O lote não foi criado." };
  if (validacao) return json({ error: "A abertura do lote ficou incompleta. Solicite auditoria.", detalhe: validacao.mensagem }, 409);
  if (lote.itens.length) return json({ error: "A abertura criou lançamentos indevidos. Solicite auditoria." }, 409);
  return json({ success: true, idempotente: false, lote }, 201);
}

async function incluirProdutoLoteV11(request, env, user, loteId) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();
  if (!Number.isInteger(loteId) || loteId <= 0) return json({ error: "Lote inválido." }, 400);
  const dados = await request.json(), produtoId = Number(dados.produto_id || 0);
  const observacao = normalizeText(dados.observacao), chaveCliente = normalizeText(dados.chave_idempotencia);
  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Produto inválido." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  const chave = `INCLUSAO_PRODUTO_LOTE:${loteId}:${chaveCliente}`;
  const existente = await env.DB.prepare("SELECT * FROM producao_lote_produtos WHERE chave_idempotencia = ?").bind(chave).first();
  if (existente) {
    if (Number(existente.lote_id) !== loteId || Number(existente.produto_id) !== produtoId || normalizeText(existente.observacao) !== observacao) return json({ error: "A chave de inclusão já foi usada com dados diferentes." }, 409);
    return json({ success: true, idempotente: true, vinculo: existente });
  }
  const lote = await buscarLoteProducaoPorId(env, loteId);
  if (!lote) return json({ error: "Lote não encontrado." }, 404);
  if (lote.fluxo !== "V1_1_GRADUAL" || lote.status !== "ABERTO") return json({ error: "Somente lotes V1.1 abertos aceitam novos produtos." }, 409);
  const jaVinculado = await env.DB.prepare("SELECT id FROM producao_lote_produtos WHERE lote_id = ? AND produto_id = ?").bind(loteId, produtoId).first();
  if (jaVinculado) return json({ error: "O produto já está vinculado ao lote." }, 409);
  try {
    await env.DB.batch([env.DB.prepare(`
      INSERT INTO producao_lote_produtos (
        lote_id, produto_id, pacotes_por_fardo_snapshot,
        valor_por_pacote_snapshot, incluido_por, observacao,
        chave_idempotencia, created_at
      ) VALUES (
        COALESCE((SELECT id FROM producao_lotes WHERE id = ? AND fluxo = 'V1_1_GRADUAL' AND status = 'ABERTO'), 0),
        COALESCE((SELECT produto.id FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), 0),
        COALESCE((SELECT parametro.pacotes_por_fardo FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), 0),
        COALESCE((SELECT parametro.valor_por_pacote FROM produtos produto INNER JOIN producao_parametros_produto parametro ON parametro.produto_id = produto.id AND parametro.ativo = 1 WHERE produto.id = ? AND produto.ativo = 'ativo'), -1),
        ?, ?, ?, CURRENT_TIMESTAMP
      )
    `).bind(loteId, produtoId, produtoId, produtoId, user.vendedorId, observacao || null, chave)]);
  } catch (err) {
    const concorrente = await env.DB.prepare("SELECT * FROM producao_lote_produtos WHERE chave_idempotencia = ?").bind(chave).first();
    if (concorrente && Number(concorrente.lote_id) === loteId && Number(concorrente.produto_id) === produtoId && normalizeText(concorrente.observacao) === observacao) return json({ success: true, idempotente: true, vinculo: concorrente });
    if (concorrente) return json({ error: "A chave de inclusão já foi usada com dados diferentes." }, 409);
    return json({ error: "O produto não foi incluído. Confirme que o lote continua aberto e o produto possui parâmetros ativos." }, 409);
  }
  const vinculo = await env.DB.prepare("SELECT * FROM producao_lote_produtos WHERE chave_idempotencia = ?").bind(chave).first();
  if (!vinculo) return json({ error: "A inclusão do produto ficou incompleta. Solicite auditoria." }, 409);
  return json({ success: true, idempotente: false, vinculo }, 201);
}

async function auditarEntradaLancamentoV11(env, registroId) {
  return env.DB.prepare(`
    SELECT registro.id AS registro_id, registro.lote_id, registro.produto_id,
      registro.usuario_id, registro.data_producao, registro.quantidade_fardos,
      registro.observacao, registro.chave_idempotencia, registro.confirmacao_fisica,
      COUNT(DISTINCT operacao.id) AS total_operacoes,
      COUNT(movimento.id) AS total_movimentos,
      MAX(operacao.id) AS operacao_id, MAX(movimento.id) AS movimentacao_id,
      MAX(movimento.local_id) AS local_id,
      MAX(movimento.produto_id) AS estoque_produto_id,
      MAX(movimento.quantidade) AS estoque_quantidade,
      MAX(movimento.efeito) AS estoque_efeito
    FROM producao_registros registro
    LEFT JOIN estoque_operacoes operacao
      ON operacao.tipo = 'ENTRADA_PRODUCAO' AND operacao.origem_tipo = 'PRODUCAO'
      AND operacao.origem_id = registro.id
      AND operacao.chave_idempotencia = 'PRODUCAO:' || CAST(registro.id AS TEXT)
    LEFT JOIN estoque_movimentacoes movimento ON movimento.operacao_id = operacao.id
    WHERE registro.id = ?
    GROUP BY registro.id
  `).bind(registroId).first();
}

function validarLancamentoV11Existente(registro, esperado, localId) {
  if (!registro) return { tipo: "INCOMPLETO", mensagem: "O lançamento não foi encontrado." };
  if (Number(registro.lote_id) !== esperado.loteId || Number(registro.produto_id) !== esperado.produtoId
    || Number(registro.usuario_id) !== esperado.usuarioId || registro.data_producao !== esperado.dataMontagem
    || Number(registro.quantidade_fardos) !== esperado.quantidadeFardos
    || normalizeText(registro.observacao) !== esperado.observacao) return { tipo: "DIVERGENTE", mensagem: "A chave do lançamento já foi usada com dados diferentes." };
  if (Number(registro.confirmacao_fisica) !== 1 || Number(registro.total_operacoes) !== 1
    || Number(registro.total_movimentos) !== 1 || Number(registro.operacao_id) <= 0
    || Number(registro.movimentacao_id) <= 0 || Number(registro.local_id) !== Number(localId)
    || Number(registro.estoque_produto_id) !== esperado.produtoId
    || Number(registro.estoque_quantidade) !== esperado.quantidadeFardos
    || Number(registro.estoque_efeito) !== 1) return { tipo: "INCOMPLETO", mensagem: "O lançamento ou sua entrada de estoque está incompleto." };
  return null;
}

async function registrarLancamentoLoteV11(request, env, user, loteId) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();
  if (!Number.isInteger(loteId) || loteId <= 0) return json({ error: "Lote inválido." }, 400);
  const dados = await request.json(), produtoId = Number(dados.produto_id || 0), quantidadeFardos = Number(dados.quantidade_fardos);
  const dataMontagem = normalizeText(dados.data_montagem || dados.data_producao || obterDataLocalCuiaba());
  const observacaoLivre = normalizeText(dados.observacao), chaveCliente = normalizeText(dados.chave_idempotencia);
  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Produto inválido." }, 400);
  if (!Number.isInteger(quantidadeFardos) || quantidadeFardos <= 0) return json({ error: "A quantidade deve ser um número inteiro de fardos maior que zero." }, 400);
  if (!dataOperacionalValida(dataMontagem)) return json({ error: "Data da montagem dos fardos inválida." }, 400);
  if (dados.confirmacao_fisica !== true) return json({ error: "Confirme fisicamente os fardos montados." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  const chave = chaveLancamentoLoteV11(loteId, chaveCliente), observacao = `MONTAGEM_FISICA_CONFIRMADA${observacaoLivre ? ` | ${observacaoLivre}` : ""}`;
  const esperado = { loteId, produtoId, usuarioId: Number(user.vendedorId), dataMontagem, quantidadeFardos, observacao };
  const registroExistente = await buscarRegistroProducaoPorChave(env, chave);
  const local = await obterEstoqueCentral(env);
  if (!local) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);
  if (registroExistente) {
    const auditoria = await auditarEntradaLancamentoV11(env, registroExistente.id);
    const validacao = validarLancamentoV11Existente(auditoria, esperado, local.id);
    if (validacao) return json({ error: validacao.tipo === "INCOMPLETO" ? "O lançamento existente está incompleto. Solicite auditoria." : validacao.mensagem, detalhe: validacao.mensagem }, 409);
    return json({ success: true, idempotente: true, lancamento: auditoria });
  }
  const lote = await buscarLoteProducaoPorId(env, loteId);
  if (!lote) return json({ error: "Lote não encontrado." }, 404);
  if (lote.fluxo !== "V1_1_GRADUAL" || lote.status !== "ABERTO") return json({ error: "Somente lotes V1.1 abertos aceitam lançamentos." }, 409);
  const vinculo = await env.DB.prepare("SELECT id FROM producao_lote_produtos WHERE lote_id = ? AND produto_id = ?").bind(loteId, produtoId).first();
  if (!vinculo) return json({ error: "O produto não está vinculado ao lote." }, 409);
  const statements = [
    env.DB.prepare(`
      INSERT INTO producao_registros (
        lote_id, produto_id, usuario_id, data_producao,
        quantidade_fardos, pacotes_por_fardo_snapshot,
        quantidade_pacotes, valor_por_pacote_snapshot,
        valor_producao, observacao, chave_idempotencia,
        created_at, confirmacao_fisica
      )
      SELECT lote.id, vinculo.produto_id, ?, ?, ?,
        vinculo.pacotes_por_fardo_snapshot,
        ? * vinculo.pacotes_por_fardo_snapshot,
        vinculo.valor_por_pacote_snapshot,
        ROUND(? * vinculo.pacotes_por_fardo_snapshot * vinculo.valor_por_pacote_snapshot, 2),
        ?, ?, CURRENT_TIMESTAMP, 1
      FROM producao_lotes lote
      INNER JOIN producao_lote_produtos vinculo ON vinculo.lote_id = lote.id AND vinculo.produto_id = ?
      WHERE lote.id = ? AND lote.fluxo = 'V1_1_GRADUAL' AND lote.status = 'ABERTO'
    `).bind(user.vendedorId, dataMontagem, quantidadeFardos, quantidadeFardos, quantidadeFardos, observacao, chave, produtoId, loteId),
    env.DB.prepare(`
      INSERT INTO estoque_operacoes (
        tipo, status, data_operacao, origem_tipo, origem_id,
        chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at
      )
      SELECT 'ENTRADA_PRODUCAO', 'CONFIRMADA', registro.data_producao,
        'PRODUCAO', registro.id, 'PRODUCAO:' || CAST(registro.id AS TEXT),
        NULL, registro.usuario_id,
        'Entrada automática da Produção #' || CAST(registro.id AS TEXT), CURRENT_TIMESTAMP
      FROM producao_registros registro WHERE registro.chave_idempotencia = ?
    `).bind(chave),
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (
        operacao_id, local_id, produto_id, carga_id, carga_item_id,
        visita_id, visita_item_id, quantidade, efeito, created_at
      ) VALUES (
        COALESCE((SELECT operacao.id FROM estoque_operacoes operacao INNER JOIN producao_registros registro ON operacao.origem_id = registro.id AND operacao.origem_tipo = 'PRODUCAO' WHERE registro.chave_idempotencia = ? AND operacao.chave_idempotencia = 'PRODUCAO:' || CAST(registro.id AS TEXT)), 0),
        ?, COALESCE((SELECT produto_id FROM producao_registros WHERE chave_idempotencia = ?), 0),
        NULL, NULL, NULL, NULL,
        COALESCE((SELECT quantidade_fardos FROM producao_registros WHERE chave_idempotencia = ?), 0),
        1, CURRENT_TIMESTAMP
      )
    `).bind(chave, local.id, chave, chave),
  ];
  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await buscarRegistroProducaoPorChave(env, chave);
    if (concorrente) {
      const auditoria = await auditarEntradaLancamentoV11(env, concorrente.id);
      const validacao = validarLancamentoV11Existente(auditoria, esperado, local.id);
      if (validacao) return json({ error: "O lançamento concorrente ficou incompleto. Solicite auditoria.", detalhe: validacao.mensagem }, 409);
      return json({ success: true, idempotente: true, lancamento: auditoria });
    }
    const loteAtual = await buscarLoteProducaoPorId(env, loteId);
    if (loteAtual?.status === "ENCERRADO") return json({ error: "O lote foi encerrado antes da confirmação do lançamento." }, 409);
    const mensagem = String(err?.message || "");
    if (mensagem.includes("CHECK constraint failed") || mensagem.includes("FOREIGN KEY constraint failed")) return json({ error: "O lançamento não foi gravado integralmente. Nenhuma entrada de estoque foi mantida." }, 409);
    throw err;
  }
  const registro = await buscarRegistroProducaoPorChave(env, chave);
  const auditoria = registro ? await auditarEntradaLancamentoV11(env, registro.id) : null;
  const validacao = validarLancamentoV11Existente(auditoria, esperado, local.id);
  if (validacao) return json({ error: "O lançamento ficou estruturalmente incompleto. Solicite auditoria.", detalhe: validacao.mensagem }, 409);
  return json({ success: true, idempotente: false, lancamento: auditoria }, 201);
}

async function encerrarLoteProducaoV11(request, env, user, loteId) {
  if (!acessoProducaoPermitido(user)) return acessoNegado();
  if (!Number.isInteger(loteId) || loteId <= 0) return json({ error: "Lote inválido." }, 400);
  const dados = await request.json(), chaveCliente = normalizeText(dados.chave_idempotencia), motivo = normalizeText(dados.motivo_encerramento);
  if (dados.confirmacao_encerramento !== true) return json({ error: "Confirme explicitamente o encerramento do lote." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de encerramento inválida." }, 400);
  const chave = `ENCERRAMENTO_LOTE:${loteId}:${chaveCliente}`;
  let lote = await buscarLoteProducaoPorId(env, loteId);
  if (!lote) return json({ error: "Lote não encontrado." }, 404);
  if (lote.fluxo !== "V1_1_GRADUAL") return json({ error: "Lotes legados não podem ser encerrados por esta rota." }, 409);
  if (lote.status === "ENCERRADO") {
    if (lote.chave_encerramento !== chave || normalizeText(lote.motivo_encerramento) !== motivo) return json({ error: "O lote já foi encerrado com dados diferentes." }, 409);
    return json({ success: true, idempotente: true, lote });
  }
  const auditoria = await env.DB.prepare(`
    SELECT COUNT(*) AS total_lancamentos,
      SUM(CASE WHEN
        (SELECT COUNT(*) FROM estoque_operacoes operacao WHERE operacao.tipo = 'ENTRADA_PRODUCAO' AND operacao.origem_tipo = 'PRODUCAO' AND operacao.origem_id = registro.id AND operacao.chave_idempotencia = 'PRODUCAO:' || CAST(registro.id AS TEXT)) <> 1
        OR (SELECT COUNT(*) FROM estoque_movimentacoes movimento INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id WHERE operacao.origem_tipo = 'PRODUCAO' AND operacao.origem_id = registro.id) <> 1
        OR NOT EXISTS (SELECT 1 FROM estoque_movimentacoes movimento INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id INNER JOIN estoque_locais local ON local.id = movimento.local_id WHERE operacao.origem_tipo = 'PRODUCAO' AND operacao.origem_id = registro.id AND local.tipo = 'CENTRAL' AND local.ativo = 1 AND movimento.produto_id = registro.produto_id AND movimento.quantidade = registro.quantidade_fardos AND movimento.efeito = 1)
      THEN 1 ELSE 0 END) AS lancamentos_incompletos
    FROM producao_registros registro WHERE registro.lote_id = ?
  `).bind(loteId).first();
  const total = Number(auditoria?.total_lancamentos || 0), incompletos = Number(auditoria?.lancamentos_incompletos || 0);
  if (incompletos) return json({ error: "O lote possui lançamentos sem entrada de estoque íntegra. Solicite auditoria." }, 409);
  if (!total && (dados.confirmacao_sem_lancamentos !== true || !motivo)) return json({ error: "Para encerrar um lote sem lançamentos, confirme a exceção e informe o motivo." }, 400);
  const resultado = await env.DB.prepare(`
    UPDATE producao_lotes
    SET status = 'ENCERRADO', encerrado_em = CURRENT_TIMESTAMP,
      encerrado_por = ?, chave_encerramento = ?, motivo_encerramento = ?
    WHERE id = ? AND fluxo = 'V1_1_GRADUAL' AND status = 'ABERTO'
  `).bind(user.vendedorId, chave, motivo || null, loteId).run();
  lote = await buscarLoteProducaoPorId(env, loteId);
  if (lote?.status === "ENCERRADO" && lote.chave_encerramento === chave && normalizeText(lote.motivo_encerramento) === motivo) return json({ success: true, idempotente: Number(resultado?.meta?.changes || 0) === 0, lote });
  if (lote?.status === "ENCERRADO") return json({ error: "O lote foi encerrado concorrentemente com dados diferentes." }, 409);
  return json({ error: "O encerramento não foi confirmado. Solicite auditoria." }, 409);
}

const TIPOS_OPERACAO_ESTOQUE = new Set([
  "INVENTARIO_INICIAL", "ENTRADA", "TRANSFERENCIA_CARGA", "SAIDA_VENDA",
  "RETORNO_CARGA", "AJUSTE_ENTRADA", "AJUSTE_SAIDA", "INVENTARIO_AJUSTE",
  "ESTORNO", "ENTRADA_PRODUCAO"
]);

function acessoEstoquePermitido(user) {
  return usuarioTemRole(user, "admin", "operacao");
}

function dataOperacionalValida(data) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(data));
}

async function obterEstoqueCentral(env) {
  return env.DB.prepare(`
    SELECT id, nome, tipo, ativo, created_at, updated_at
    FROM estoque_locais
    WHERE tipo = 'CENTRAL' AND ativo = 1
    ORDER BY id
    LIMIT 1
  `).first();
}

async function inicializarEstoqueCentral(env, user) {
  if (!usuarioTemRole(user, "admin")) return acessoNegado();

  const existente = await obterEstoqueCentral(env);
  if (existente) return json({ success: true, criado: false, local: existente });

  let criado = true;
  try {
    await env.DB.prepare(`
      INSERT INTO estoque_locais (nome, tipo, vendedor_id, ativo, created_at, updated_at)
      VALUES ('ESTOQUE CENTRAL', 'CENTRAL', NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
  } catch (err) {
    const criadoConcorrentemente = await obterEstoqueCentral(env);
    if (!criadoConcorrentemente) throw err;
    criado = false;
  }

  const local = await obterEstoqueCentral(env);
  return json({ success: true, criado, local }, criado ? 201 : 200);
}

async function consultarEstoqueCentral(env, user) {
  if (!acessoEstoquePermitido(user)) return acessoNegado();

  const local = await obterEstoqueCentral(env);
  if (!local) {
    return json({ local: null, inicializacao_necessaria: true, produtos: [] });
  }

  const resultado = await env.DB.prepare(`
    SELECT
      p.id AS produto_id,
      p.nome AS produto_nome,
      COALESCE(SUM(m.quantidade * m.efeito), 0) AS saldo_atual,
      MAX(m.created_at) AS ultima_movimentacao,
      CASE WHEN EXISTS (
        SELECT 1
        FROM estoque_operacoes inventario
        WHERE inventario.tipo = 'INVENTARIO_INICIAL'
          AND inventario.chave_idempotencia =
            'INVENTARIO_INICIAL:' || CAST(? AS INTEGER) || ':' || CAST(p.id AS INTEGER)
      ) THEN 1 ELSE 0 END AS inventario_inicial_registrado
    FROM produtos p
    LEFT JOIN estoque_movimentacoes m
      ON m.produto_id = p.id AND m.local_id = ?
    LEFT JOIN estoque_operacoes o ON o.id = m.operacao_id
    WHERE p.ativo = 'ativo'
    GROUP BY p.id, p.nome
    ORDER BY p.nome
  `).bind(local.id, local.id).all();

  const produtos = (resultado.results || []).map(produto => {
    const saldo = Number(produto.saldo_atual || 0);
    return {
      ...produto,
      saldo_atual: saldo,
      inventario_inicial_registrado: Number(produto.inventario_inicial_registrado || 0) === 1,
      situacao: saldo < 0 ? "DIVERGENCIA" : saldo === 0 ? "ZERADO" : "DISPONIVEL",
    };
  });

  return json({ local, inicializacao_necessaria: false, produtos });
}

async function consultarDisponibilidadeEstoqueCentral(request, env, user) {
  if (!usuarioTemRole(user, "admin", "operacao", "vendedor")) return acessoNegado();
  const url = new URL(request.url);
  const parametros = [...url.searchParams.keys()];
  const valoresProduto = url.searchParams.getAll("produto_id");
  if (parametros.length !== 1 || parametros[0] !== "produto_id" || valoresProduto.length !== 1
    || !/^\d+$/.test(valoresProduto[0])) {
    return json({ error: "Informe exatamente um produto_id inteiro positivo." }, 400);
  }
  const produtoId = Number(valoresProduto[0]);
  if (!Number.isSafeInteger(produtoId) || produtoId <= 0) return json({ error: "Produto inválido." }, 400);
  const disponibilidade = await env.DB.prepare(`
    SELECT produto.id AS produto_id, produto.nome AS produto_nome,
      COALESCE(SUM(movimento.quantidade * movimento.efeito), 0) AS saldo_oficial
    FROM produtos produto
    CROSS JOIN estoque_locais local
    LEFT JOIN estoque_movimentacoes movimento
      ON movimento.local_id = local.id AND movimento.produto_id = produto.id
    WHERE produto.id = ? AND produto.ativo = 'ativo'
      AND local.tipo = 'CENTRAL' AND local.ativo = 1
    GROUP BY produto.id, produto.nome
  `).bind(produtoId).first();
  if (!disponibilidade) return json({ error: "Produto ativo não encontrado." }, 404);
  const saldoOficial = Number(disponibilidade.saldo_oficial || 0);
  const quantidadeDisponivel = Math.max(saldoOficial, 0);
  return json({
    produto_id: Number(disponibilidade.produto_id),
    produto_nome: disponibilidade.produto_nome,
    quantidade_disponivel: quantidadeDisponivel,
    situacao: quantidadeDisponivel > 0 ? "DISPONIVEL" : "SEM_ESTOQUE",
    consultado_em: new Date().toISOString(),
  });
}

async function listarMovimentacoesEstoque(request, env, user) {
  if (!acessoEstoquePermitido(user)) return acessoNegado();

  const local = await obterEstoqueCentral(env);
  if (!local) return json({ local: null, movimentacoes: [] });

  const url = new URL(request.url);
  const produtoId = Number(url.searchParams.get("produto_id") || 0);
  const usuarioId = Number(url.searchParams.get("usuario_id") || 0);
  const tipo = normalizeText(url.searchParams.get("tipo")).toUpperCase();
  const dataInicial = normalizeText(url.searchParams.get("data_inicial"));
  const dataFinal = normalizeText(url.searchParams.get("data_final"));

  if (produtoId && (!Number.isInteger(produtoId) || produtoId <= 0)) return json({ error: "Produto inválido." }, 400);
  if (usuarioId && (!Number.isInteger(usuarioId) || usuarioId <= 0)) return json({ error: "Usuário inválido." }, 400);
  if (tipo && !TIPOS_OPERACAO_ESTOQUE.has(tipo)) return json({ error: "Tipo de operação inválido." }, 400);
  if (dataInicial && !dataOperacionalValida(dataInicial)) return json({ error: "Data inicial inválida." }, 400);
  if (dataFinal && !dataOperacionalValida(dataFinal)) return json({ error: "Data final inválida." }, 400);
  if (dataInicial && dataFinal && dataInicial > dataFinal) return json({ error: "Período inválido." }, 400);

  const filtros = ["m.local_id = ?"];
  const parametros = [local.id];
  if (produtoId) { filtros.push("m.produto_id = ?"); parametros.push(produtoId); }
  if (usuarioId) { filtros.push("o.usuario_id = ?"); parametros.push(usuarioId); }
  if (tipo) { filtros.push("o.tipo = ?"); parametros.push(tipo); }
  if (dataInicial) { filtros.push("o.data_operacao >= ?"); parametros.push(dataInicial); }
  if (dataFinal) { filtros.push("o.data_operacao <= ?"); parametros.push(dataFinal); }

  const resultado = await env.DB.prepare(`
    SELECT
      m.id, m.operacao_id, m.produto_id, p.nome AS produto_nome,
      m.quantidade, m.efeito, m.created_at,
      o.tipo, o.status, o.data_operacao, o.origem_tipo,
      o.origem_id,
      o.usuario_id, v.nome AS usuario_nome, o.observacao,
      o.chave_idempotencia
    FROM estoque_movimentacoes m
    INNER JOIN estoque_operacoes o ON o.id = m.operacao_id
    INNER JOIN produtos p ON p.id = m.produto_id
    LEFT JOIN vendedores v ON v.id = o.usuario_id
    WHERE ${filtros.join(" AND ")}
    ORDER BY o.data_operacao DESC, m.id DESC
    LIMIT 500
  `).bind(...parametros).all();

  return json({ local, movimentacoes: resultado.results || [] });
}

async function buscarOperacaoPorChave(env, chave) {
  return env.DB.prepare(`
    SELECT id, tipo, status, data_operacao, chave_idempotencia, usuario_id, observacao, created_at
    FROM estoque_operacoes
    WHERE chave_idempotencia = ?
  `).bind(chave).first();
}

async function registrarMovimentoEstoque(request, env, user, configuracao) {
  if (!acessoEstoquePermitido(user)) return acessoNegado();

  const dados = await request.json();
  const produtoId = Number(dados.produto_id || 0);
  const quantidadeInformada = dados.quantidade === null || dados.quantidade === undefined
    ? ""
    : String(dados.quantidade).trim();
  const quantidade = quantidadeInformada === "" ? Number.NaN : Number(dados.quantidade);
  const dataOperacao = normalizeText(dados.data_operacao || obterDataLocalCuiaba());
  const observacao = normalizeText(dados.observacao);
  const chaveRecebida = normalizeText(dados.chave_idempotencia);
  const local = await obterEstoqueCentral(env);

  if (!local) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);
  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Selecione um produto válido." }, 400);
  if (!Number.isFinite(quantidade) || quantidade < 0) return json({ error: "A quantidade não pode ser negativa." }, 400);
  if (!configuracao.inventario && quantidade === 0) return json({ error: "A quantidade deve ser maior que zero." }, 400);
  if (!dataOperacionalValida(dataOperacao)) return json({ error: "Data operacional inválida." }, 400);
  if (configuracao.observacaoObrigatoria && !observacao) return json({ error: "Informe o motivo do ajuste." }, 400);
  if (!configuracao.inventario && !chaveRecebida) return json({ error: "Chave de idempotência obrigatória." }, 400);
  if (chaveRecebida.length > 180) return json({ error: "Chave de idempotência inválida." }, 400);

  const produto = await env.DB.prepare(`
    SELECT id, nome FROM produtos
    WHERE id = ? AND ativo = 'ativo'
  `).bind(produtoId).first();
  if (!produto) return json({ error: "Produto ativo não encontrado." }, 404);

  const chave = configuracao.inventario
    ? `INVENTARIO_INICIAL:${local.id}:${produtoId}`
    : `${configuracao.tipo}:${chaveRecebida}`;

  const existente = await buscarOperacaoPorChave(env, chave);
  if (existente) {
    if (configuracao.inventario) {
      return json({ error: "O inventário inicial deste produto já foi registrado.", operacao: existente }, 409);
    }
    return json({ success: true, idempotente: true, operacao: existente });
  }

  try {
    const gravacoes = [
      env.DB.prepare(`
        INSERT INTO estoque_operacoes (
          tipo, status, data_operacao, origem_tipo, origem_id,
          chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at
        ) VALUES (?, 'CONFIRMADA', ?, ?, NULL, ?, NULL, ?, ?, CURRENT_TIMESTAMP)
      `).bind(configuracao.tipo, dataOperacao, configuracao.origemTipo, chave, user.vendedorId, observacao || null),
    ];
    if (quantidade > 0) {
      gravacoes.push(env.DB.prepare(`
        INSERT INTO estoque_movimentacoes (
          operacao_id, local_id, produto_id, carga_id, carga_item_id,
          visita_id, visita_item_id, quantidade, efeito, created_at
        )
        SELECT id, ?, ?, NULL, NULL, NULL, NULL, ?, ?, CURRENT_TIMESTAMP
        FROM estoque_operacoes WHERE chave_idempotencia = ?
      `).bind(local.id, produtoId, quantidade, configuracao.efeito, chave));
    }
    await env.DB.batch(gravacoes);
  } catch (err) {
    const concorrente = await buscarOperacaoPorChave(env, chave);
    if (concorrente) {
      if (configuracao.inventario) {
        return json({ error: "O inventário inicial deste produto já foi registrado.", operacao: concorrente }, 409);
      }
      return json({ success: true, idempotente: true, operacao: concorrente });
    }
    throw err;
  }

  const operacao = await buscarOperacaoPorChave(env, chave);
  return json({ success: true, idempotente: false, operacao, produto, quantidade, efeito: configuracao.efeito }, 201);
}

async function registrarInventarioInicial(request, env, user) {
  return registrarMovimentoEstoque(request, env, user, {
    tipo: "INVENTARIO_INICIAL", origemTipo: "INVENTARIO", efeito: 1,
    inventario: true, observacaoObrigatoria: false,
  });
}

async function registrarEntradaEstoque(request, env, user) {
  return registrarMovimentoEstoque(request, env, user, {
    tipo: "ENTRADA", origemTipo: "MANUAL", efeito: 1,
    inventario: false, observacaoObrigatoria: false,
  });
}

async function registrarAjusteEstoque(request, env, user) {
  if (!acessoEstoquePermitido(user)) return acessoNegado();
  const dados = await request.clone().json();
  const tipo = normalizeText(dados.tipo).toUpperCase();
  if (!new Set(["AJUSTE_ENTRADA", "AJUSTE_SAIDA"]).has(tipo)) {
    return json({ error: "Tipo de ajuste inválido." }, 400);
  }
  return registrarMovimentoEstoque(request, env, user, {
    tipo, origemTipo: "AJUSTE", efeito: tipo === "AJUSTE_ENTRADA" ? 1 : -1,
    inventario: false, observacaoObrigatoria: true,
  });
}

function acessoCargaPermitido(user) {
  return usuarioTemRole(user, "admin", "operacao");
}

function chaveTransferenciaCarga(chaveCliente) {
  return `TRANSFERENCIA_CARGA:${chaveCliente}`;
}

async function listarVendedoresCarga(env, user) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  const resultado = await env.DB.prepare(`
    SELECT id, nome FROM vendedores
    WHERE role = 'vendedor' AND status = 'ativo'
    ORDER BY nome COLLATE NOCASE, id
  `).all();
  return json(resultado.results || []);
}

async function carregarCargaCompleta(env, cargaId) {
  const carga = await env.DB.prepare(`
    SELECT carga.id, carga.data_carga, carga.vendedor_id,
      vendedor.nome AS vendedor_nome, carga.local_carga_id,
      local.nome AS local_carga_nome, carga.status,
      carga.aberta_em, carga.aberta_por, auditor.nome AS auditor_nome,
      carga.fechada_em, carga.fechada_por, fechador.nome AS fechador_nome,
      carga.cancelada_em, carga.cancelada_por,
      cancelador.nome AS cancelador_nome, carga.motivo_cancelamento,
      carga.observacoes_abertura, carga.observacoes_fechamento,
      carga.created_at, carga.updated_at
    FROM estoque_cargas carga
    INNER JOIN vendedores vendedor ON vendedor.id = carga.vendedor_id
    INNER JOIN estoque_locais local ON local.id = carga.local_carga_id
    LEFT JOIN vendedores auditor ON auditor.id = carga.aberta_por
    LEFT JOIN vendedores fechador ON fechador.id = carga.fechada_por
    LEFT JOIN vendedores cancelador ON cancelador.id = carga.cancelada_por
    WHERE carga.id = ?
  `).bind(cargaId).first();
  if (!carga) return null;

  const itens = await env.DB.prepare(`
    SELECT item.id, item.carga_id, item.produto_id,
      produto.nome AS produto_nome, item.quantidade_carregada,
      item.quantidade_retornada, item.quantidade_vendida_fechamento,
      item.saldo_esperado_fechamento, item.diferenca_fechamento,
      item.observacao, item.created_at,
      SUM(CASE WHEN operacao.tipo = 'TRANSFERENCIA_CARGA' AND movimento.local_id = central.id AND movimento.efeito = -1 THEN 1 ELSE 0 END) AS saidas_central,
      SUM(CASE WHEN operacao.tipo = 'TRANSFERENCIA_CARGA' AND movimento.local_id = carga.local_carga_id AND movimento.efeito = 1 THEN 1 ELSE 0 END) AS entradas_carga,
      SUM(CASE WHEN operacao.tipo = 'TRANSFERENCIA_CARGA' AND movimento.local_id = central.id AND movimento.efeito = -1 THEN movimento.quantidade ELSE 0 END) AS quantidade_saida,
      SUM(CASE WHEN operacao.tipo = 'TRANSFERENCIA_CARGA' AND movimento.local_id = carga.local_carga_id AND movimento.efeito = 1 THEN movimento.quantidade ELSE 0 END) AS quantidade_entrada
    FROM estoque_carga_itens item
    INNER JOIN estoque_cargas carga ON carga.id = item.carga_id
    INNER JOIN produtos produto ON produto.id = item.produto_id
    INNER JOIN estoque_locais central ON central.tipo = 'CENTRAL' AND central.ativo = 1
    LEFT JOIN estoque_movimentacoes movimento ON movimento.carga_item_id = item.id
    LEFT JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
    WHERE item.carga_id = ?
    GROUP BY item.id, produto.nome, carga.local_carga_id
    ORDER BY produto.nome COLLATE NOCASE, item.id
  `).bind(cargaId).all();
  let saldoOperacional = null;
  if (carga.status === "ABERTA") saldoOperacional = await env.DB.prepare(`
    WITH produtos_carga AS (
      SELECT produto_id
      FROM estoque_carga_itens
      WHERE carga_id = ?
      UNION
      SELECT produto_id
      FROM estoque_movimentacoes
      WHERE local_id = ?
    ), carregado AS (
      SELECT produto_id, SUM(quantidade_carregada) AS total_carregado
      FROM estoque_carga_itens
      WHERE carga_id = ?
      GROUP BY produto_id
    ), vendido_rota AS (
      SELECT movimento.produto_id, SUM(movimento.quantidade) AS total_vendido_rota
      FROM estoque_movimentacoes movimento
      INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
      INNER JOIN visitas visita ON visita.id = movimento.visita_id
      WHERE movimento.carga_id = ? AND movimento.local_id = ?
        AND movimento.efeito = -1
        AND operacao.tipo = 'SAIDA_VENDA' AND operacao.status = 'CONFIRMADA'
        AND visita.status_registro = 'ATIVA' AND visita.canal_venda = 'ROTA'
      GROUP BY movimento.produto_id
    ), estornos_ajustes AS (
      SELECT movimento.produto_id,
        SUM(movimento.quantidade * movimento.efeito) AS total_estornos_ajustes
      FROM estoque_movimentacoes movimento
      INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
      WHERE movimento.local_id = ? AND movimento.carga_id = ?
        AND operacao.status = 'CONFIRMADA'
        AND operacao.tipo NOT IN ('TRANSFERENCIA_CARGA', 'SAIDA_VENDA')
      GROUP BY movimento.produto_id
    ), nao_classificados AS (
      SELECT movimento.produto_id,
        SUM(movimento.quantidade * movimento.efeito) AS total_nao_classificado
      FROM estoque_movimentacoes movimento
      INNER JOIN estoque_operacoes operacao ON operacao.id = movimento.operacao_id
      WHERE movimento.local_id = ? AND movimento.carga_id IS NULL
        AND movimento.created_at >= ? AND operacao.status = 'CONFIRMADA'
        AND operacao.tipo NOT IN ('TRANSFERENCIA_CARGA', 'SAIDA_VENDA')
      GROUP BY movimento.produto_id
    ), saldo_local AS (
      SELECT produto_id, SUM(quantidade * efeito) AS saldo_atual
      FROM estoque_movimentacoes
      WHERE local_id = ?
      GROUP BY produto_id
    )
    SELECT produto.id AS produto_id, produto.nome AS produto_nome,
      COALESCE(carregado.total_carregado, 0) AS total_carregado,
      COALESCE(vendido_rota.total_vendido_rota, 0) AS total_vendido_rota,
      COALESCE(estornos_ajustes.total_estornos_ajustes, 0) AS total_estornos_ajustes,
      COALESCE(nao_classificados.total_nao_classificado, 0) AS total_nao_classificado,
      COALESCE(saldo_local.saldo_atual, 0) AS saldo_atual,
      CASE
        WHEN COALESCE(saldo_local.saldo_atual, 0) > 0 THEN 'DISPONIVEL'
        WHEN COALESCE(saldo_local.saldo_atual, 0) < 0 THEN 'DIVERGENTE'
        ELSE 'ZERADO'
      END AS situacao
    FROM produtos_carga
    INNER JOIN produtos produto ON produto.id = produtos_carga.produto_id
    LEFT JOIN carregado ON carregado.produto_id = produtos_carga.produto_id
    LEFT JOIN vendido_rota ON vendido_rota.produto_id = produtos_carga.produto_id
    LEFT JOIN estornos_ajustes ON estornos_ajustes.produto_id = produtos_carga.produto_id
    LEFT JOIN nao_classificados ON nao_classificados.produto_id = produtos_carga.produto_id
    LEFT JOIN saldo_local ON saldo_local.produto_id = produtos_carga.produto_id
    ORDER BY produto.nome COLLATE NOCASE, produto.id
  `).bind(cargaId, carga.local_carga_id, cargaId, cargaId, carga.local_carga_id,
    carga.local_carga_id, cargaId, carga.local_carga_id, carga.aberta_em,
    carga.local_carga_id).all();
  const operacoesResultado = await env.DB.prepare(`
    SELECT operacao.id, operacao.tipo, operacao.status,
      operacao.data_operacao, operacao.chave_idempotencia,
      operacao.operacao_estornada_id, operacao.usuario_id,
      usuario.nome AS usuario_nome, operacao.observacao,
      operacao.created_at, original.chave_idempotencia AS chave_operacao_original
    FROM estoque_operacoes operacao
    LEFT JOIN vendedores usuario ON usuario.id = operacao.usuario_id
    LEFT JOIN estoque_operacoes original ON original.id = operacao.operacao_estornada_id
    WHERE (
      operacao.tipo = 'TRANSFERENCIA_CARGA'
      AND operacao.origem_tipo = 'CARGA' AND operacao.origem_id = ?
    ) OR (
      operacao.tipo = 'RETORNO_CARGA'
      AND operacao.origem_tipo = 'CARGA' AND operacao.origem_id = ?
    ) OR (
      operacao.tipo IN ('AJUSTE_ENTRADA', 'AJUSTE_SAIDA')
      AND operacao.origem_tipo = 'CARGA' AND operacao.origem_id = ?
    ) OR (
      operacao.tipo = 'ESTORNO'
      AND operacao.operacao_estornada_id IN (
        SELECT id FROM estoque_operacoes
        WHERE tipo = 'TRANSFERENCIA_CARGA'
          AND origem_tipo = 'CARGA' AND origem_id = ?
      )
    )
    ORDER BY operacao.created_at, operacao.id
  `).bind(cargaId, cargaId, cargaId, cargaId).all();
  const operacoes = operacoesResultado.results || [];
  if (operacoes.length) {
    const ids = operacoes.map(() => "?").join(",");
    const movimentos = await env.DB.prepare(`
      SELECT movimento.id, movimento.operacao_id, movimento.local_id,
        local.nome AS local_nome, local.tipo AS local_tipo,
        movimento.produto_id, produto.nome AS produto_nome,
        movimento.carga_id, movimento.carga_item_id,
        movimento.quantidade, movimento.efeito, movimento.created_at
      FROM estoque_movimentacoes movimento
      INNER JOIN estoque_locais local ON local.id = movimento.local_id
      INNER JOIN produtos produto ON produto.id = movimento.produto_id
      WHERE movimento.operacao_id IN (${ids})
      ORDER BY movimento.operacao_id, produto.nome COLLATE NOCASE, movimento.efeito
    `).bind(...operacoes.map(operacao => operacao.id)).all();
    const porOperacao = new Map(operacoes.map(operacao => [Number(operacao.id), []]));
    for (const movimento of movimentos.results || []) porOperacao.get(Number(movimento.operacao_id))?.push(movimento);
    for (const operacao of operacoes) {
      operacao.movimentacoes = porOperacao.get(Number(operacao.id)) || [];
      operacao.classificacao = operacao.tipo === "RETORNO_CARGA" ? "RETORNO_CARGA"
        : operacao.tipo === "ESTORNO"
        ? "CANCELAMENTO_ESTORNO"
        : operacao.tipo === "AJUSTE_ENTRADA" || operacao.tipo === "AJUSTE_SAIDA"
          ? "CONFERENCIA_SALDO"
        : String(operacao.chave_idempotencia).startsWith("COMPLEMENTO_CARGA:")
          ? "COMPLEMENTO" : "CARGA_INICIAL";
      if (operacao.tipo === "RETORNO_CARGA" && String(operacao.observacao || "").startsWith("FECHAMENTO_CARGA:")) {
        try { operacao.observacao = JSON.parse(String(operacao.observacao).slice("FECHAMENTO_CARGA:".length)).observacao || operacao.observacao; } catch { /* preserva a auditoria bruta */ }
      }
    }
  }
  return { ...carga, itens: itens.results || [], saldo_operacional: saldoOperacional?.results || null, operacoes };
}

async function carregarTransferenciaCargaPorChave(env, chave) {
  const operacao = await env.DB.prepare(`
    SELECT id, status, data_operacao, origem_id, chave_idempotencia,
      usuario_id, observacao, created_at
    FROM estoque_operacoes
    WHERE tipo = 'TRANSFERENCIA_CARGA'
      AND origem_tipo = 'CARGA' AND chave_idempotencia = ?
  `).bind(chave).first();
  if (!operacao?.origem_id) return null;
  const carga = await carregarCargaCompleta(env, Number(operacao.origem_id));
  if (!carga) return null;
  const movimentos = await env.DB.prepare(`
    SELECT movimento.produto_id, movimento.local_id,
      movimento.quantidade, movimento.efeito, local.tipo AS local_tipo
    FROM estoque_movimentacoes movimento
    INNER JOIN estoque_locais local ON local.id = movimento.local_id
    WHERE movimento.operacao_id = ?
    ORDER BY movimento.produto_id, movimento.efeito
  `).bind(operacao.id).all();
  const agrupados = new Map();
  for (const movimento of movimentos.results || []) {
    const produtoId = Number(movimento.produto_id);
    if (!agrupados.has(produtoId)) agrupados.set(produtoId, { produto_id: produtoId, saidas_central: 0, entradas_carga: 0, quantidade_saida: 0, quantidade_entrada: 0 });
    const item = agrupados.get(produtoId);
    if (movimento.local_tipo === "CENTRAL" && Number(movimento.efeito) === -1) {
      item.saidas_central += 1; item.quantidade_saida += Number(movimento.quantidade);
    }
    if (movimento.local_id === carga.local_carga_id && Number(movimento.efeito) === 1) {
      item.entradas_carga += 1; item.quantidade_entrada += Number(movimento.quantidade);
    }
  }
  return { ...carga, operacao, itens_operacao: [...agrupados.values()] };
}

async function carregarCargaPorChave(env, chave) {
  return carregarTransferenciaCargaPorChave(env, chave);
}

function validarCargaExistente(carga, esperado) {
  if (Number(carga.vendedor_id) !== esperado.vendedorId
    || carga.data_carga !== esperado.dataCarga
    || Number(carga.aberta_por) !== esperado.auditorId
    || normalizeText(carga.observacoes_abertura) !== esperado.observacoesAbertura) {
    return { tipo: "DIVERGENTE", mensagem: "A chave de idempotência já foi usada com dados diferentes." };
  }
  if (carga.status !== "ABERTA" || carga.operacao?.status !== "CONFIRMADA" || carga.itens_operacao.length !== esperado.itens.length) {
    return { tipo: "INCOMPLETA", mensagem: "A carga existente está estruturalmente incompleta." };
  }
  const itensPorProduto = new Map(carga.itens_operacao.map(item => [Number(item.produto_id), item]));
  for (const esperadoItem of esperado.itens) {
    const item = itensPorProduto.get(esperadoItem.produtoId);
    if (!item) return { tipo: "INCOMPLETA", mensagem: "A carga existente não possui todos os produtos esperados." };
    if (Number(item.saidas_central) !== 1 || Number(item.entradas_carga) !== 1
      || Number(item.quantidade_saida) !== esperadoItem.quantidade
      || Number(item.quantidade_entrada) !== esperadoItem.quantidade) {
      return { tipo: "INCOMPLETA", mensagem: "A transferência de estoque da carga está incompleta." };
    }
  }
  return null;
}

function respostaConflitoCarga(validacao, carga) {
  return json({
    error: validacao.tipo === "INCOMPLETA"
      ? "A carga já existe, mas sua estrutura está incompleta. Solicite auditoria."
      : validacao.mensagem,
    detalhe: validacao.mensagem, carga_id: carga.id,
  }, 409);
}

async function registrarCargaVendedor(request, env, user) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  const dados = await request.json();
  const vendedorId = Number(dados.vendedor_id || 0);
  const dataCarga = normalizeText(dados.data_carga || obterDataLocalCuiaba());
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  const observacao = normalizeText(dados.observacao);
  const itensRecebidos = Array.isArray(dados.itens) ? dados.itens : [];
  if (!Number.isInteger(vendedorId) || vendedorId <= 0) return json({ error: "Selecione um vendedor válido." }, 400);
  if (!dataOperacionalValida(dataCarga)) return json({ error: "Data da carga inválida." }, 400);
  if (dados.confirmacao_auditoria !== true) return json({ error: "Confirme que a carga foi conferida fisicamente." }, 400);
  if (!chaveCliente || chaveCliente.length > 140) return json({ error: "Chave de idempotência inválida." }, 400);
  if (!itensRecebidos.length) return json({ error: "Adicione ao menos um produto à carga." }, 400);

  const itens = itensRecebidos.map(item => ({ produtoId: Number(item?.produto_id || 0), quantidade: Number(item?.quantidade) }));
  if (itens.some(item => !Number.isInteger(item.produtoId) || item.produtoId <= 0)) return json({ error: "Todos os itens devem possuir produto válido." }, 400);
  if (itens.some(item => !Number.isInteger(item.quantidade) || item.quantidade <= 0)) return json({ error: "A quantidade deve ser um número inteiro de fardos maior que zero." }, 400);
  if (new Set(itens.map(item => item.produtoId)).size !== itens.length) return json({ error: "O mesmo produto não pode aparecer duas vezes na carga." }, 400);

  const [central, vendedor] = await Promise.all([
    obterEstoqueCentral(env),
    env.DB.prepare("SELECT id, nome FROM vendedores WHERE id = ? AND role = 'vendedor' AND status = 'ativo'").bind(vendedorId).first(),
  ]);
  if (!central) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);
  if (!vendedor) return json({ error: "Vendedor ativo não encontrado." }, 404);

  const chave = chaveTransferenciaCarga(chaveCliente);
  const observacoesAbertura = `AUDITORIA_FISICA_CONFIRMADA${observacao ? ` | ${observacao}` : ""}`;
  const esperado = { vendedorId, dataCarga, auditorId: Number(user.vendedorId), observacoesAbertura, itens };
  const existente = await carregarCargaPorChave(env, chave);
  if (existente) {
    const validacao = validarCargaExistente(existente, esperado);
    if (validacao) return respostaConflitoCarga(validacao, existente);
    return json({ success: true, idempotente: true, carga: existente });
  }

  const produtos = await Promise.all(itens.map(item => env.DB.prepare(`
    SELECT p.id, p.nome, COALESCE(SUM(m.quantidade * m.efeito), 0) AS saldo_atual
    FROM produtos p
    LEFT JOIN estoque_movimentacoes m ON m.produto_id = p.id AND m.local_id = ?
    WHERE p.id = ? AND p.ativo = 'ativo'
    GROUP BY p.id, p.nome
  `).bind(central.id, item.produtoId).first()));
  if (produtos.some(produto => !produto)) return json({ error: "Todos os produtos devem existir e estar ativos." }, 409);
  const indiceInsuficiente = itens.findIndex((item, indice) => item.quantidade > Number(produtos[indice].saldo_atual || 0));
  if (indiceInsuficiente >= 0) return json({
    error: `Saldo insuficiente para ${produtos[indiceInsuficiente].nome}.`,
    produto_id: itens[indiceInsuficiente].produtoId,
    saldo_disponivel: Number(produtos[indiceInsuficiente].saldo_atual || 0),
  }, 409);

  const cargaAberta = await env.DB.prepare("SELECT id FROM estoque_cargas WHERE vendedor_id = ? AND status = 'ABERTA'").bind(vendedorId).first();
  if (cargaAberta) return json({ error: "O vendedor já possui uma carga aberta.", carga_id: cargaAberta.id }, 409);

  const statements = [
    env.DB.prepare(`
      INSERT OR IGNORE INTO estoque_locais (nome, tipo, vendedor_id, ativo, created_at, updated_at)
      SELECT 'CARGA - ' || nome, 'CARGA_VENDEDOR', id, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM vendedores WHERE id = ? AND role = 'vendedor' AND status = 'ativo'
    `).bind(vendedorId),
    env.DB.prepare(`
      INSERT INTO estoque_cargas (data_carga, vendedor_id, local_carga_id, status,
        aberta_em, aberta_por, observacoes_abertura, created_at, updated_at)
      SELECT ?, vendedor.id, local.id, 'ABERTA', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM vendedores vendedor
      INNER JOIN estoque_locais local ON local.vendedor_id = vendedor.id
        AND local.tipo = 'CARGA_VENDEDOR' AND local.ativo = 1
      WHERE vendedor.id = ? AND vendedor.role = 'vendedor' AND vendedor.status = 'ativo'
    `).bind(dataCarga, user.vendedorId, observacoesAbertura, vendedorId),
  ];
  for (const item of itens) statements.push(env.DB.prepare(`
    INSERT INTO estoque_carga_itens (carga_id, produto_id, quantidade_carregada, observacao, created_at, updated_at)
    SELECT carga.id, produto.id, ?, 'Conferido fisicamente na abertura', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM estoque_cargas carga
    INNER JOIN produtos produto ON produto.id = ? AND produto.ativo = 'ativo'
    WHERE carga.vendedor_id = ? AND carga.data_carga = ? AND carga.status = 'ABERTA'
  `).bind(item.quantidade, item.produtoId, vendedorId, dataCarga));
  statements.push(env.DB.prepare(`
    INSERT INTO estoque_operacoes (tipo, status, data_operacao, origem_tipo, origem_id,
      chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at)
    SELECT 'TRANSFERENCIA_CARGA', 'CONFIRMADA', carga.data_carga, 'CARGA', carga.id,
      ?, NULL, ?, 'Carga conferida fisicamente por ' || ?, CURRENT_TIMESTAMP
    FROM estoque_cargas carga
    WHERE carga.vendedor_id = ? AND carga.data_carga = ? AND carga.status = 'ABERTA'
  `).bind(chave, user.vendedorId, user.nome, vendedorId, dataCarga));

  for (const item of itens) statements.push(
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (operacao_id, local_id, produto_id, carga_id, carga_item_id,
        visita_id, visita_item_id, quantidade, efeito, created_at)
      VALUES (
        COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0), ?, ?,
        COALESCE((SELECT id FROM estoque_cargas WHERE vendedor_id = ? AND data_carga = ? AND status = 'ABERTA'), 0),
        COALESCE((SELECT item.id FROM estoque_carga_itens item INNER JOIN estoque_cargas carga ON carga.id = item.carga_id
          WHERE carga.vendedor_id = ? AND carga.data_carga = ? AND carga.status = 'ABERTA' AND item.produto_id = ?), 0),
        NULL, NULL,
        COALESCE((SELECT ? WHERE ? <= (SELECT COALESCE(SUM(m.quantidade * m.efeito), 0)
          FROM estoque_movimentacoes m WHERE m.local_id = ? AND m.produto_id = ?)), 0),
        -1, CURRENT_TIMESTAMP)
    `).bind(chave, central.id, item.produtoId, vendedorId, dataCarga, vendedorId, dataCarga,
      item.produtoId, item.quantidade, item.quantidade, central.id, item.produtoId),
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (operacao_id, local_id, produto_id, carga_id, carga_item_id,
        visita_id, visita_item_id, quantidade, efeito, created_at)
      VALUES (
        COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0),
        COALESCE((SELECT id FROM estoque_locais WHERE tipo = 'CARGA_VENDEDOR' AND vendedor_id = ? AND ativo = 1), 0), ?,
        COALESCE((SELECT id FROM estoque_cargas WHERE vendedor_id = ? AND data_carga = ? AND status = 'ABERTA'), 0),
        COALESCE((SELECT item.id FROM estoque_carga_itens item INNER JOIN estoque_cargas carga ON carga.id = item.carga_id
          WHERE carga.vendedor_id = ? AND carga.data_carga = ? AND carga.status = 'ABERTA' AND item.produto_id = ?), 0),
        NULL, NULL, ?, 1, CURRENT_TIMESTAMP)
    `).bind(chave, vendedorId, item.produtoId, vendedorId, dataCarga, vendedorId, dataCarga, item.produtoId, item.quantidade)
  );

  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await carregarCargaPorChave(env, chave);
    if (concorrente) {
      const validacao = validarCargaExistente(concorrente, esperado);
      if (validacao) return respostaConflitoCarga(validacao, concorrente);
      return json({ success: true, idempotente: true, carga: concorrente });
    }
    const mensagem = String(err?.message || "");
    if (mensagem.includes("UNIQUE constraint failed: estoque_cargas")) return json({ error: "O vendedor já possui uma carga aberta ou uma carga válida nesta data." }, 409);
    if (mensagem.includes("CHECK constraint failed") || mensagem.includes("FOREIGN KEY constraint failed")) return json({ error: "A carga não foi registrada. Confira novamente o saldo disponível e os dados informados." }, 409);
    throw err;
  }
  const carga = await carregarCargaPorChave(env, chave);
  if (!carga) throw new Error("A transação não confirmou a criação da carga.");
  const validacaoFinal = validarCargaExistente(carga, esperado);
  if (validacaoFinal) throw new Error(`Carga criada com estrutura inválida: ${validacaoFinal.mensagem}`);
  return json({ success: true, idempotente: false, carga }, 201);
}

function chaveComplementoCarga(cargaId, chaveCliente) {
  return `COMPLEMENTO_CARGA:${cargaId}:${chaveCliente}`;
}

function validarComplementoExistente(transferencia, esperado) {
  if (Number(transferencia.id) !== esperado.cargaId
    || Number(transferencia.operacao?.usuario_id) !== esperado.auditorId
    || normalizeText(transferencia.operacao?.observacao) !== esperado.observacaoOperacao) {
    return { tipo: "DIVERGENTE", mensagem: "A chave de idempotência do complemento já foi usada com dados diferentes." };
  }
  if (transferencia.status !== "ABERTA" || transferencia.operacao?.status !== "CONFIRMADA"
    || transferencia.itens_operacao.length !== esperado.itens.length) {
    return { tipo: "INCOMPLETA", mensagem: "O complemento existente está estruturalmente incompleto." };
  }
  const porProduto = new Map(transferencia.itens_operacao.map(item => [Number(item.produto_id), item]));
  for (const esperadoItem of esperado.itens) {
    const item = porProduto.get(esperadoItem.produtoId);
    if (!item) return { tipo: "INCOMPLETA", mensagem: "O complemento não possui todos os produtos esperados." };
    if (Number(item.saidas_central) !== 1 || Number(item.entradas_carga) !== 1
      || Number(item.quantidade_saida) !== esperadoItem.quantidade
      || Number(item.quantidade_entrada) !== esperadoItem.quantidade) {
      return { tipo: "DIVERGENTE", mensagem: "O complemento existente possui quantidades diferentes." };
    }
  }
  return null;
}

async function registrarComplementoCarga(request, env, user, cargaId) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  if (!Number.isInteger(cargaId) || cargaId <= 0) return json({ error: "Carga inválida." }, 400);
  const dados = await request.json();
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  const observacao = normalizeText(dados.observacao);
  const itensRecebidos = Array.isArray(dados.itens) ? dados.itens : [];
  if (dados.confirmacao_auditoria !== true) return json({ error: "Confirme que o complemento foi conferido fisicamente." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  if (!itensRecebidos.length) return json({ error: "Adicione ao menos um produto ao complemento." }, 400);
  const itens = itensRecebidos.map(item => ({ produtoId: Number(item?.produto_id || 0), quantidade: Number(item?.quantidade) }));
  if (itens.some(item => !Number.isInteger(item.produtoId) || item.produtoId <= 0)) return json({ error: "Todos os itens devem possuir produto válido." }, 400);
  if (itens.some(item => !Number.isInteger(item.quantidade) || item.quantidade <= 0)) return json({ error: "A quantidade complementar deve ser um número inteiro de fardos maior que zero." }, 400);
  if (new Set(itens.map(item => item.produtoId)).size !== itens.length) return json({ error: "O mesmo produto não pode aparecer duas vezes no complemento." }, 400);

  const [carga, central] = await Promise.all([carregarCargaCompleta(env, cargaId), obterEstoqueCentral(env)]);
  if (!carga) return json({ error: "Carga não encontrada." }, 404);
  if (carga.status !== "ABERTA") return json({ error: "Somente cargas abertas podem receber complementos." }, 409);
  if (!central) return json({ error: "Estoque Central ainda não foi inicializado." }, 409);
  const chave = chaveComplementoCarga(cargaId, chaveCliente);
  const observacaoOperacao = `COMPLEMENTO_AUDITADO por ${user.nome}${observacao ? ` | ${observacao}` : ""}`;
  const esperado = { cargaId, auditorId: Number(user.vendedorId), observacaoOperacao, itens };
  const existente = await carregarTransferenciaCargaPorChave(env, chave);
  if (existente) {
    const validacao = validarComplementoExistente(existente, esperado);
    if (validacao) return respostaConflitoCarga(validacao, existente);
    return json({ success: true, idempotente: true, carga: existente });
  }

  const produtos = await Promise.all(itens.map(item => env.DB.prepare(`
    SELECT produto.id, produto.nome,
      COALESCE(SUM(movimento.quantidade * movimento.efeito), 0) AS saldo_atual
    FROM produtos produto
    LEFT JOIN estoque_movimentacoes movimento
      ON movimento.produto_id = produto.id AND movimento.local_id = ?
    WHERE produto.id = ? AND produto.ativo = 'ativo'
    GROUP BY produto.id, produto.nome
  `).bind(central.id, item.produtoId).first()));
  if (produtos.some(produto => !produto)) return json({ error: "Todos os produtos devem existir e estar ativos." }, 409);
  const indiceInsuficiente = itens.findIndex((item, indice) => item.quantidade > Number(produtos[indice].saldo_atual || 0));
  if (indiceInsuficiente >= 0) return json({
    error: `Saldo insuficiente para ${produtos[indiceInsuficiente].nome}.`,
    produto_id: itens[indiceInsuficiente].produtoId,
    saldo_disponivel: Number(produtos[indiceInsuficiente].saldo_atual || 0),
  }, 409);

  const statements = [];
  for (const item of itens) statements.push(
    env.DB.prepare(`
      UPDATE estoque_carga_itens
      SET quantidade_carregada = quantidade_carregada + ?, updated_at = CURRENT_TIMESTAMP
      WHERE carga_id = ? AND produto_id = ?
        AND EXISTS (SELECT 1 FROM produtos WHERE id = ? AND ativo = 'ativo')
        AND EXISTS (SELECT 1 FROM estoque_cargas WHERE id = ? AND status = 'ABERTA')
    `).bind(item.quantidade, cargaId, item.produtoId, item.produtoId, cargaId),
    env.DB.prepare(`
      INSERT INTO estoque_carga_itens (
        carga_id, produto_id, quantidade_carregada, observacao, created_at, updated_at
      )
      SELECT carga.id, produto.id, ?,
        'Adicionado em complemento auditado', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM estoque_cargas carga
      INNER JOIN produtos produto ON produto.id = ? AND produto.ativo = 'ativo'
      WHERE carga.id = ? AND carga.status = 'ABERTA'
        AND NOT EXISTS (
          SELECT 1 FROM estoque_carga_itens item
          WHERE item.carga_id = carga.id AND item.produto_id = produto.id
        )
    `).bind(item.quantidade, item.produtoId, cargaId)
  );
  statements.push(env.DB.prepare(`
    INSERT INTO estoque_operacoes (
      tipo, status, data_operacao, origem_tipo, origem_id,
      chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at
    )
    SELECT 'TRANSFERENCIA_CARGA', 'CONFIRMADA', carga.data_carga,
      'CARGA', carga.id, ?, NULL, ?, ?, CURRENT_TIMESTAMP
    FROM estoque_cargas carga WHERE carga.id = ? AND carga.status = 'ABERTA'
  `).bind(chave, user.vendedorId, observacaoOperacao, cargaId));
  for (const item of itens) statements.push(
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (
        operacao_id, local_id, produto_id, carga_id, carga_item_id,
        visita_id, visita_item_id, quantidade, efeito, created_at
      ) VALUES (
        COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0),
        ?, ?, ?,
        COALESCE((SELECT id FROM estoque_carga_itens WHERE carga_id = ? AND produto_id = ?), 0),
        NULL, NULL,
        COALESCE((SELECT ? WHERE ? <= (
          SELECT COALESCE(SUM(movimento.quantidade * movimento.efeito), 0)
          FROM estoque_movimentacoes movimento
          WHERE movimento.local_id = ? AND movimento.produto_id = ?
        )), 0), -1, CURRENT_TIMESTAMP
      )
    `).bind(chave, central.id, item.produtoId, cargaId, cargaId, item.produtoId,
      item.quantidade, item.quantidade, central.id, item.produtoId),
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (
        operacao_id, local_id, produto_id, carga_id, carga_item_id,
        visita_id, visita_item_id, quantidade, efeito, created_at
      ) VALUES (
        COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0),
        ?, ?, ?,
        COALESCE((SELECT id FROM estoque_carga_itens WHERE carga_id = ? AND produto_id = ?), 0),
        NULL, NULL, ?, 1, CURRENT_TIMESTAMP
      )
    `).bind(chave, carga.local_carga_id, item.produtoId, cargaId, cargaId, item.produtoId, item.quantidade)
  );
  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await carregarTransferenciaCargaPorChave(env, chave);
    if (concorrente) {
      const validacao = validarComplementoExistente(concorrente, esperado);
      if (validacao) return respostaConflitoCarga(validacao, concorrente);
      return json({ success: true, idempotente: true, carga: concorrente });
    }
    const mensagem = String(err?.message || "");
    if (mensagem.includes("CHECK constraint failed") || mensagem.includes("FOREIGN KEY constraint failed")) {
      return json({ error: "O complemento não foi registrado. Confira o status da carga e o saldo disponível." }, 409);
    }
    throw err;
  }
  const transferencia = await carregarTransferenciaCargaPorChave(env, chave);
  if (!transferencia) throw new Error("A transação não confirmou o complemento da carga.");
  const validacaoFinal = validarComplementoExistente(transferencia, esperado);
  if (validacaoFinal) throw new Error(`Complemento criado com estrutura inválida: ${validacaoFinal.mensagem}`);
  return json({ success: true, idempotente: false, carga: transferencia }, 201);
}

function validarEstruturaCancelamento(carga) {
  const transferencias = carga.operacoes.filter(operacao => operacao.tipo === "TRANSFERENCIA_CARGA");
  if (!transferencias.length) return { mensagem: "A carga não possui transferências para estornar." };
  const totaisTransferidos = new Map();
  for (const operacao of transferencias) {
    const porProduto = new Map();
    for (const movimento of operacao.movimentacoes) {
      if (Number(movimento.carga_id) !== Number(carga.id) || !movimento.carga_item_id) {
        return { mensagem: `A operação #${operacao.id} possui vínculo inválido com a carga.` };
      }
      const produtoId = Number(movimento.produto_id);
      if (!porProduto.has(produtoId)) porProduto.set(produtoId, { central: [], carga: [] });
      if (movimento.local_tipo === "CENTRAL" && Number(movimento.efeito) === -1) porProduto.get(produtoId).central.push(movimento);
      if (Number(movimento.local_id) === Number(carga.local_carga_id) && Number(movimento.efeito) === 1) porProduto.get(produtoId).carga.push(movimento);
    }
    if (!porProduto.size || operacao.movimentacoes.length !== porProduto.size * 2) return { mensagem: `A operação #${operacao.id} possui movimentos inesperados.` };
    for (const movimentos of porProduto.values()) {
      if (movimentos.central.length !== 1 || movimentos.carga.length !== 1
        || Number(movimentos.central[0].quantidade) !== Number(movimentos.carga[0].quantidade)) {
        return { mensagem: `A operação #${operacao.id} não forma uma transferência íntegra.` };
      }
      const movimentoCarga = movimentos.carga[0];
      totaisTransferidos.set(Number(movimentoCarga.produto_id),
        (totaisTransferidos.get(Number(movimentoCarga.produto_id)) || 0) + Number(movimentoCarga.quantidade));
    }
  }
  if (carga.itens.length !== totaisTransferidos.size) return { mensagem: "Os itens acumulados não correspondem aos produtos transferidos." };
  for (const item of carga.itens) {
    if (Number(item.quantidade_carregada) !== Number(totaisTransferidos.get(Number(item.produto_id)) || 0)) {
      return { mensagem: `A quantidade acumulada do produto #${item.produto_id} não corresponde às transferências.` };
    }
  }
  return null;
}

function validarCancelamentoConcluido(carga) {
  if (carga.status !== "CANCELADA") return { mensagem: "A carga não está cancelada." };
  const transferencias = carga.operacoes.filter(operacao => operacao.tipo === "TRANSFERENCIA_CARGA");
  const estornos = carga.operacoes.filter(operacao => operacao.tipo === "ESTORNO");
  if (!transferencias.length || estornos.length !== transferencias.length) return { mensagem: "A quantidade de estornos não corresponde às transferências." };
  for (const original of transferencias) {
    const correspondentes = estornos.filter(estorno => Number(estorno.operacao_estornada_id) === Number(original.id));
    if (original.status !== "ESTORNADA" || correspondentes.length !== 1 || correspondentes[0].status !== "CONFIRMADA") return { mensagem: `A operação #${original.id} não possui estorno íntegro.` };
    const estorno = correspondentes[0];
    if (estorno.movimentacoes.length !== original.movimentacoes.length) return { mensagem: `O estorno da operação #${original.id} está incompleto.` };
    for (const movimento of original.movimentacoes) {
      const inverso = estorno.movimentacoes.find(item => Number(item.local_id) === Number(movimento.local_id)
        && Number(item.produto_id) === Number(movimento.produto_id)
        && Number(item.quantidade) === Number(movimento.quantidade)
        && Number(item.efeito) === -Number(movimento.efeito));
      if (!inverso) return { mensagem: `O estorno da operação #${original.id} não contém todos os movimentos inversos.` };
    }
  }
  return null;
}

async function cancelarCargaVendedor(request, env, user, cargaId) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  if (!Number.isInteger(cargaId) || cargaId <= 0) return json({ error: "Carga inválida." }, 400);
  const dados = await request.json();
  const motivo = normalizeText(dados.motivo_cancelamento);
  if (!motivo) return json({ error: "Informe o motivo do cancelamento." }, 400);
  if (motivo.length > 500) return json({ error: "O motivo do cancelamento é muito longo." }, 400);
  if (dados.confirmacao_cancelamento !== true) return json({ error: "Confirme explicitamente o cancelamento integral da carga." }, 400);
  let carga = await carregarCargaCompleta(env, cargaId);
  if (!carga) return json({ error: "Carga não encontrada." }, 404);
  if (carga.status === "CANCELADA") {
    if (normalizeText(carga.motivo_cancelamento) !== motivo) return json({ error: "A carga já foi cancelada com outro motivo." }, 409);
    const validacao = validarCancelamentoConcluido(carga);
    if (validacao) return json({ error: "O cancelamento existente está incompleto. Solicite auditoria.", detalhe: validacao.mensagem }, 409);
    return json({ success: true, idempotente: true, carga });
  }
  if (carga.status !== "ABERTA") return json({ error: "Somente cargas abertas podem ser canceladas." }, 409);
  const estrutura = validarEstruturaCancelamento(carga);
  if (estrutura) return json({ error: "A carga possui estrutura inconsistente. Solicite auditoria.", detalhe: estrutura.mensagem }, 409);
  const transferencias = carga.operacoes.filter(operacao => operacao.tipo === "TRANSFERENCIA_CARGA");
  const estornosExistentes = carga.operacoes.filter(operacao => operacao.tipo === "ESTORNO");
  if (estornosExistentes.length || transferencias.some(operacao => operacao.status !== "CONFIRMADA")) {
    return json({ error: "A carga possui cancelamento parcial. Solicite auditoria." }, 409);
  }

  const totaisPorProduto = new Map();
  for (const operacao of transferencias) for (const movimento of operacao.movimentacoes) {
    if (Number(movimento.local_id) === Number(carga.local_carga_id) && Number(movimento.efeito) === 1) {
      totaisPorProduto.set(Number(movimento.produto_id), (totaisPorProduto.get(Number(movimento.produto_id)) || 0) + Number(movimento.quantidade));
    }
  }
  for (const [produtoId, quantidade] of totaisPorProduto) {
    const saldo = await env.DB.prepare(`
      SELECT COALESCE(SUM(quantidade * efeito), 0) AS saldo
      FROM estoque_movimentacoes WHERE local_id = ? AND produto_id = ?
    `).bind(carga.local_carga_id, produtoId).first();
    if (Number(saldo?.saldo || 0) < quantidade) return json({
      error: "O local do vendedor não possui saldo suficiente para o estorno integral.",
      produto_id: produtoId, saldo_disponivel: Number(saldo?.saldo || 0), quantidade_estorno: quantidade,
    }, 409);
  }

  const quantidadeTransferenciasSnapshot = transferencias.length;
  const maiorTransferenciaIdSnapshot = Math.max(...transferencias.map(operacao => Number(operacao.id)));
  const statements = [env.DB.prepare(`
    UPDATE estoque_cargas
    SET status = 'CANCELADA', cancelada_em = CURRENT_TIMESTAMP,
      cancelada_por = ?, motivo_cancelamento = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'ABERTA'
      AND (
        SELECT COUNT(*) FROM estoque_operacoes operacao
        WHERE operacao.tipo = 'TRANSFERENCIA_CARGA'
          AND operacao.origem_tipo = 'CARGA' AND operacao.origem_id = estoque_cargas.id
      ) = ?
      AND COALESCE((
        SELECT MAX(operacao.id) FROM estoque_operacoes operacao
        WHERE operacao.tipo = 'TRANSFERENCIA_CARGA'
          AND operacao.origem_tipo = 'CARGA' AND operacao.origem_id = estoque_cargas.id
      ), 0) = ?
  `).bind(
    user.vendedorId, motivo, cargaId,
    quantidadeTransferenciasSnapshot, maiorTransferenciaIdSnapshot
  )];
  for (const original of transferencias) {
    const chaveEstorno = `ESTORNO_CARGA:${cargaId}:OPERACAO:${original.id}`;
    statements.push(env.DB.prepare(`
      INSERT INTO estoque_operacoes (
        tipo, status, data_operacao, origem_tipo, origem_id,
        chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at
      )
      SELECT 'ESTORNO', 'CONFIRMADA', carga.data_carga, 'CARGA', carga.id,
        ?, ?, ?, ?, CURRENT_TIMESTAMP
      FROM estoque_cargas carga
      WHERE carga.id = ? AND carga.status = 'CANCELADA'
        AND carga.cancelada_por = ? AND carga.motivo_cancelamento = ?
    `).bind(
      chaveEstorno, original.id, user.vendedorId,
      `Cancelamento da carga #${cargaId}: ${motivo}`,
      cargaId, user.vendedorId, motivo
    ));
    for (const movimento of original.movimentacoes) {
      const quantidadeProtegida = Number(movimento.local_id) === Number(carga.local_carga_id) && Number(movimento.efeito) === 1;
      statements.push(env.DB.prepare(`
        INSERT INTO estoque_movimentacoes (
          operacao_id, local_id, produto_id, carga_id, carga_item_id,
          visita_id, visita_item_id, quantidade, efeito, created_at
        ) VALUES (
          COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0),
          ?, ?, ?, ?, NULL, NULL,
          ${quantidadeProtegida ? `COALESCE((SELECT ? WHERE ? <= (
            SELECT COALESCE(SUM(quantidade * efeito), 0) FROM estoque_movimentacoes
            WHERE local_id = ? AND produto_id = ?
          )), 0)` : "?"},
          ?, CURRENT_TIMESTAMP
        )
      `).bind(...(quantidadeProtegida
        ? [chaveEstorno, movimento.local_id, movimento.produto_id, cargaId, movimento.carga_item_id,
          movimento.quantidade, movimento.quantidade, movimento.local_id, movimento.produto_id, -Number(movimento.efeito)]
        : [chaveEstorno, movimento.local_id, movimento.produto_id, cargaId, movimento.carga_item_id,
          movimento.quantidade, -Number(movimento.efeito)])));
    }
    statements.push(env.DB.prepare(`
      UPDATE estoque_operacoes SET status = 'ESTORNADA'
      WHERE id = ? AND status = 'CONFIRMADA'
        AND EXISTS (
          SELECT 1 FROM estoque_cargas carga
          WHERE carga.id = ? AND carga.status = 'CANCELADA'
            AND carga.cancelada_por = ? AND carga.motivo_cancelamento = ?
        )
    `).bind(original.id, cargaId, user.vendedorId, motivo));
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    carga = await carregarCargaCompleta(env, cargaId);
    if (carga?.status === "CANCELADA") {
      if (normalizeText(carga.motivo_cancelamento) !== motivo) return json({ error: "A carga já foi cancelada com outro motivo." }, 409);
      const validacao = validarCancelamentoConcluido(carga);
      if (validacao) return json({ error: "O cancelamento existente está incompleto. Solicite auditoria.", detalhe: validacao.mensagem }, 409);
      return json({ success: true, idempotente: true, carga });
    }
    const mensagem = String(err?.message || "");
    if (mensagem.includes("CHECK constraint failed") || mensagem.includes("FOREIGN KEY constraint failed")) return json({ error: "O cancelamento não foi concluído. Confira o saldo do local do vendedor." }, 409);
    throw err;
  }
  carga = await carregarCargaCompleta(env, cargaId);
  const validacaoFinal = carga ? validarCancelamentoConcluido(carga) : { mensagem: "Carga não encontrada após a transação." };
  if (validacaoFinal) throw new Error(`Cancelamento criado com estrutura inválida: ${validacaoFinal.mensagem}`);
  return json({ success: true, idempotente: false, carga });
}

async function listarCargasVendedor(request, env, user) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  const url = new URL(request.url), vendedorId = Number(url.searchParams.get("vendedor_id") || 0);
  const dataInicial = normalizeText(url.searchParams.get("data_inicial")), dataFinal = normalizeText(url.searchParams.get("data_final"));
  if (vendedorId && (!Number.isInteger(vendedorId) || vendedorId <= 0)) return json({ error: "Vendedor inválido." }, 400);
  if (dataInicial && !dataOperacionalValida(dataInicial)) return json({ error: "Data inicial inválida." }, 400);
  if (dataFinal && !dataOperacionalValida(dataFinal)) return json({ error: "Data final inválida." }, 400);
  if (dataInicial && dataFinal && dataInicial > dataFinal) return json({ error: "Período inválido." }, 400);
  const filtros = ["1 = 1"], parametros = [];
  if (vendedorId) { filtros.push("carga.vendedor_id = ?"); parametros.push(vendedorId); }
  if (dataInicial) { filtros.push("carga.data_carga >= ?"); parametros.push(dataInicial); }
  if (dataFinal) { filtros.push("carga.data_carga <= ?"); parametros.push(dataFinal); }
  const resultado = await env.DB.prepare(`
    SELECT carga.id, carga.data_carga, carga.vendedor_id, vendedor.nome AS vendedor_nome,
      carga.status, carga.aberta_em, carga.aberta_por, auditor.nome AS auditor_nome,
      COUNT(item.id) AS total_produtos, COALESCE(SUM(item.quantidade_carregada), 0) AS total_fardos
    FROM estoque_cargas carga
    INNER JOIN vendedores vendedor ON vendedor.id = carga.vendedor_id
    LEFT JOIN vendedores auditor ON auditor.id = carga.aberta_por
    LEFT JOIN estoque_carga_itens item ON item.carga_id = carga.id
    WHERE ${filtros.join(" AND ")}
    GROUP BY carga.id, vendedor.nome, auditor.nome
    ORDER BY carga.data_carga DESC, carga.id DESC LIMIT 500
  `).bind(...parametros).all();
  return json(resultado.results || []);
}

async function obterCargaVendedor(env, user, cargaId) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  if (!Number.isInteger(cargaId) || cargaId <= 0) return json({ error: "Carga inválida." }, 400);
  const carga = await carregarCargaCompleta(env, cargaId);
  if (!carga) return json({ error: "Carga não encontrada." }, 404);
  return json(carga);
}

function chaveConferenciaCarga(cargaId, chaveCliente) {
  return `CONFERENCIA_CARGA:${cargaId}:${chaveCliente}`;
}

function dadosAuditoriaConferencia(dados) {
  return `CONFERENCIA_SALDO:${JSON.stringify(dados)}`;
}

async function carregarConferenciaCargaPorChave(env, chave) {
  const operacao = await env.DB.prepare(`
    SELECT operacao.id, operacao.tipo, operacao.status, operacao.origem_id,
      operacao.chave_idempotencia, operacao.usuario_id, operacao.observacao,
      operacao.created_at, movimento.local_id, movimento.produto_id,
      movimento.carga_id, movimento.carga_item_id, movimento.quantidade,
      movimento.efeito
    FROM estoque_operacoes operacao
    LEFT JOIN estoque_movimentacoes movimento ON movimento.operacao_id = operacao.id
    WHERE operacao.chave_idempotencia = ?
  `).bind(chave).first();
  if (!operacao) return null;
  const prefixo = "CONFERENCIA_SALDO:";
  let auditoria = null;
  if (String(operacao.observacao || "").startsWith(prefixo)) {
    try { auditoria = JSON.parse(String(operacao.observacao).slice(prefixo.length)); } catch { auditoria = null; }
  }
  return { ...operacao, auditoria };
}

function conferenciaCargaCompativel(conferencia, esperado) {
  const auditoria = conferencia?.auditoria;
  return conferencia?.tipo === esperado.tipo && conferencia?.status === "CONFIRMADA"
    && Number(conferencia.origem_id) === esperado.cargaId
    && Number(conferencia.carga_id) === esperado.cargaId
    && Number(conferencia.local_id) === esperado.localId
    && Number(conferencia.produto_id) === esperado.produtoId
    && Number(conferencia.quantidade) === Math.abs(esperado.diferenca)
    && Number(conferencia.efeito) === Math.sign(esperado.diferenca)
    && auditoria && Number(auditoria.produto_id) === esperado.produtoId
    && Number(auditoria.saldo_anterior) === esperado.saldoAnterior
    && Number(auditoria.quantidade_fisica) === esperado.quantidadeFisica
    && Number(auditoria.diferenca) === esperado.diferenca
    && normalizeText(auditoria.motivo) === esperado.motivo;
}

async function registrarConferenciaCarga(request, env, user, cargaId) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  if (!Number.isInteger(cargaId) || cargaId <= 0) return json({ error: "Carga inválida." }, 400);
  const dados = await request.json();
  const produtoId = Number(dados.produto_id || 0);
  const quantidadeFisica = Number(dados.quantidade_fisica);
  const saldoEsperado = Number(dados.saldo_esperado);
  const motivo = normalizeText(dados.motivo);
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ error: "Produto inválido." }, 400);
  if (!Number.isInteger(quantidadeFisica) || quantidadeFisica < 0) return json({ error: "A quantidade física deve ser um número inteiro maior ou igual a zero." }, 400);
  if (!Number.isFinite(saldoEsperado)) return json({ error: "Saldo esperado inválido. Atualize o detalhe da carga." }, 400);
  if (!motivo) return json({ error: "Informe o motivo da conferência." }, 400);
  if (dados.confirmacao_fisica !== true || dados.confirmacao_explicita !== true) return json({ error: "Confirme a contagem física e o registro do ajuste." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);

  const chave = chaveConferenciaCarga(cargaId, chaveCliente);
  const existente = await carregarConferenciaCargaPorChave(env, chave);
  if (existente) {
    const auditoria = existente.auditoria;
    if (!auditoria || Number(auditoria.saldo_anterior) !== saldoEsperado) return json({ error: "A chave de idempotência já foi usada com conteúdo diferente." }, 409);
    const esperadoExistente = auditoria ? {
      cargaId, localId: Number(existente.local_id), produtoId,
      quantidadeFisica, saldoAnterior: Number(auditoria.saldo_anterior),
      diferenca: Number(auditoria.diferenca), motivo, tipo: existente.tipo,
    } : null;
    if (!esperadoExistente || !conferenciaCargaCompativel(existente, esperadoExistente)) return json({ error: "A chave de idempotência já foi usada com conteúdo diferente." }, 409);
    return json({ success: true, idempotente: true, sem_ajuste: false, conferencia: existente });
  }

  const estado = await env.DB.prepare(`
    SELECT carga.id, carga.status, carga.local_carga_id,
      item.id AS carga_item_id, produto.nome AS produto_nome,
      COALESCE((SELECT SUM(movimento.quantidade * movimento.efeito)
        FROM estoque_movimentacoes movimento
        WHERE movimento.local_id = carga.local_carga_id AND movimento.produto_id = produto.id), 0) AS saldo_atual
    FROM estoque_cargas carga
    INNER JOIN produtos produto ON produto.id = ?
    LEFT JOIN estoque_carga_itens item ON item.carga_id = carga.id AND item.produto_id = produto.id
    WHERE carga.id = ? AND (
      item.id IS NOT NULL OR EXISTS (SELECT 1 FROM estoque_movimentacoes movimento
        WHERE movimento.local_id = carga.local_carga_id AND movimento.produto_id = produto.id)
    )
  `).bind(produtoId, cargaId).first();
  if (!estado) return json({ error: "Produto não pertence ao saldo operacional desta carga." }, 409);
  if (estado.status !== "ABERTA") return json({ error: "Somente cargas abertas podem receber conferência de saldo." }, 409);
  const saldoAnterior = Number(estado.saldo_atual || 0);
  if (saldoAnterior !== saldoEsperado) return json({ error: "O saldo mudou. Atualize o detalhe da carga e confira novamente.", saldo_atual: saldoAnterior }, 409);
  const diferenca = quantidadeFisica - saldoAnterior;
  if (diferenca === 0) return json({ success: true, idempotente: false, sem_ajuste: true, saldo_anterior: saldoAnterior, saldo_atual: saldoAnterior });

  const tipo = diferenca > 0 ? "AJUSTE_ENTRADA" : "AJUSTE_SAIDA";
  const auditoria = { produto_id: produtoId, produto_nome: estado.produto_nome, saldo_anterior: saldoAnterior, quantidade_fisica: quantidadeFisica, diferenca, motivo };
  const observacao = dadosAuditoriaConferencia(auditoria);
  const statements = [
    env.DB.prepare(`
      INSERT INTO estoque_operacoes (tipo, status, data_operacao, origem_tipo, origem_id,
        chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at)
      SELECT ?, 'CONFIRMADA', ?, 'CARGA', carga.id, ?, NULL, ?, ?, CURRENT_TIMESTAMP
      FROM estoque_cargas carga
      WHERE carga.id = ? AND carga.status = 'ABERTA' AND carga.local_carga_id = ?
        AND NOT EXISTS (SELECT 1 FROM estoque_operacoes WHERE chave_idempotencia = ?)
        AND EXISTS (SELECT 1 FROM produtos WHERE id = ?)
        AND (EXISTS (SELECT 1 FROM estoque_carga_itens WHERE carga_id = carga.id AND produto_id = ?)
          OR EXISTS (SELECT 1 FROM estoque_movimentacoes WHERE local_id = carga.local_carga_id AND produto_id = ?))
        AND ? = (SELECT COALESCE(SUM(quantidade * efeito), 0) FROM estoque_movimentacoes
          WHERE local_id = carga.local_carga_id AND produto_id = ?)
    `).bind(tipo, obterDataLocalCuiaba(), chave, user.vendedorId, observacao, cargaId,
      estado.local_carga_id, chave, produtoId, produtoId, produtoId, saldoAnterior, produtoId),
    env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (operacao_id, local_id, produto_id, carga_id,
        carga_item_id, visita_id, visita_item_id, quantidade, efeito, created_at)
      VALUES (COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0),
        ?, ?, ?, (SELECT id FROM estoque_carga_itens WHERE carga_id = ? AND produto_id = ?),
        NULL, NULL, ?, ?, CURRENT_TIMESTAMP)
    `).bind(chave, estado.local_carga_id, produtoId, cargaId, cargaId, produtoId,
      Math.abs(diferenca), Math.sign(diferenca)),
  ];
  try {
    await env.DB.batch(statements);
  } catch (err) {
    const concorrente = await carregarConferenciaCargaPorChave(env, chave);
    const esperado = { cargaId, localId: Number(estado.local_carga_id), produtoId, quantidadeFisica, saldoAnterior, diferenca, motivo, tipo };
    if (concorrente) {
      if (!conferenciaCargaCompativel(concorrente, esperado)) return json({ error: "A chave de idempotência já foi usada com conteúdo diferente." }, 409);
      return json({ success: true, idempotente: true, sem_ajuste: false, conferencia: concorrente });
    }
    return json({ error: "O estado da carga ou o saldo mudou. Atualize o detalhe e confira novamente." }, 409);
  }
  const conferencia = await carregarConferenciaCargaPorChave(env, chave);
  if (!conferencia) throw new Error("A conferência não foi confirmada após a transação.");
  return json({ success: true, idempotente: false, sem_ajuste: false, saldo_anterior: saldoAnterior, saldo_atual: quantidadeFisica, diferenca, conferencia }, 201);
}

function chaveFechamentoCarga(cargaId, chaveCliente) {
  return `FECHAMENTO_CARGA:${cargaId}:${chaveCliente}`;
}

function auditoriaFechamentoCarga(cargaId, itens, observacao, confirmacaoFisica, confirmacaoTexto) {
  return {
    carga_id: Number(cargaId),
    itens: [...itens].sort((a, b) => a.produtoId - b.produtoId)
      .map(item => ({ produto_id: item.produtoId, quantidade_fisica: item.quantidadeFisica })),
    observacao: normalizeText(observacao),
    confirmacao_fisica: confirmacaoFisica === true,
    confirmacao_texto: normalizeText(confirmacaoTexto).toUpperCase(),
  };
}

async function carregarFechamentoCargaPorChave(env, chave) {
  const operacao = await env.DB.prepare(`
    SELECT id, tipo, status, origem_tipo, origem_id, chave_idempotencia,
      usuario_id, observacao, created_at
    FROM estoque_operacoes WHERE chave_idempotencia = ?
  `).bind(chave).first();
  if (!operacao) return null;
  const prefixo = "FECHAMENTO_CARGA:";
  let auditoria = null;
  if (String(operacao.observacao || "").startsWith(prefixo)) {
    try { auditoria = JSON.parse(String(operacao.observacao).slice(prefixo.length)); } catch { auditoria = null; }
  }
  return { ...operacao, auditoria };
}

function fechamentoCargaCompativel(fechamento, cargaId, auditoria) {
  return fechamento?.tipo === "RETORNO_CARGA" && fechamento?.status === "CONFIRMADA"
    && fechamento?.origem_tipo === "CARGA" && Number(fechamento.origem_id) === cargaId
    && JSON.stringify(fechamento.auditoria) === JSON.stringify(auditoria);
}

async function auditarFechamentoCarga(env, cargaId, chave, auditoria) {
  const carga = await env.DB.prepare("SELECT status, local_carga_id, fechada_em, fechada_por FROM estoque_cargas WHERE id = ?").bind(cargaId).first();
  const operacao = await carregarFechamentoCargaPorChave(env, chave);
  if (!carga || carga.status !== "FECHADA" || !carga.fechada_em || !carga.fechada_por || !fechamentoCargaCompativel(operacao, cargaId, auditoria)) return "Cabeçalho do fechamento inválido.";
  const movimentos = await env.DB.prepare(`SELECT local.tipo AS local_tipo, movimento.produto_id,
    movimento.carga_id, movimento.quantidade, movimento.efeito
    FROM estoque_movimentacoes movimento INNER JOIN estoque_locais local ON local.id = movimento.local_id
    WHERE movimento.operacao_id = ? ORDER BY movimento.produto_id, movimento.efeito`).bind(operacao.id).all();
  const esperados = auditoria.itens.filter(item => item.quantidade_fisica > 0);
  if ((movimentos.results || []).length !== esperados.length * 2) return "Quantidade de movimentos de retorno inválida.";
  for (const item of esperados) {
    const pares = (movimentos.results || []).filter(m => Number(m.produto_id) === item.produto_id && Number(m.carga_id) === cargaId && Number(m.quantidade) === item.quantidade_fisica);
    if (pares.length !== 2 || !pares.some(m => m.local_tipo === "CARGA_VENDEDOR" && Number(m.efeito) === -1) || !pares.some(m => m.local_tipo === "CENTRAL" && Number(m.efeito) === 1)) return `Retorno incompatível para o produto #${item.produto_id}.`;
  }
  const divergente = await env.DB.prepare(`SELECT produto_id, SUM(quantidade * efeito) AS saldo
    FROM estoque_movimentacoes WHERE local_id = ? GROUP BY produto_id HAVING SUM(quantidade * efeito) <> 0 LIMIT 1`).bind(carga.local_carga_id).first();
  return divergente ? `O veículo ainda possui saldo no produto #${divergente.produto_id}.` : null;
}

async function fecharCargaVendedor(request, env, user, cargaId) {
  if (!acessoCargaPermitido(user)) return acessoNegado();
  if (!Number.isInteger(cargaId) || cargaId <= 0) return json({ error: "Carga inválida." }, 400);
  const dados = await request.json();
  const observacao = normalizeText(dados.observacao);
  const chaveCliente = normalizeText(dados.chave_idempotencia);
  const recebidos = Array.isArray(dados.itens) ? dados.itens : [];
  if (!observacao) return json({ error: "Informe a observação de fechamento." }, 400);
  if (!chaveCliente || chaveCliente.length > 120) return json({ error: "Chave de idempotência inválida." }, 400);
  const itens = recebidos.map(item => ({ produtoId: Number(item?.produto_id || 0), quantidadeFisica: Number(item?.quantidade_fisica) })).sort((a, b) => a.produtoId - b.produtoId);
  if (itens.some(item => !Number.isInteger(item.produtoId) || item.produtoId <= 0)) return json({ error: "Todos os produtos devem ser válidos." }, 400);
  if (itens.some(item => !Number.isInteger(item.quantidadeFisica) || item.quantidadeFisica < 0)) return json({ error: "As quantidades físicas devem ser inteiros maiores ou iguais a zero." }, 400);
  if (new Set(itens.map(item => item.produtoId)).size !== itens.length) return json({ error: "O mesmo produto não pode aparecer duas vezes." }, 400);

  const chave = chaveFechamentoCarga(cargaId, chaveCliente);
  const auditoria = auditoriaFechamentoCarga(cargaId, itens, observacao, dados.confirmacao_fisica, dados.confirmacao_texto);
  const existente = await carregarFechamentoCargaPorChave(env, chave);
  if (existente) {
    if (!fechamentoCargaCompativel(existente, cargaId, auditoria)) return json({ error: "A chave de idempotência já foi usada com conteúdo diferente." }, 409);
    const carga = await carregarCargaCompleta(env, cargaId);
    if (!carga || await auditarFechamentoCarga(env, cargaId, chave, auditoria)) return json({ error: "O fechamento existente está estruturalmente incompleto. Solicite auditoria." }, 409);
    return json({ success: true, idempotente: true, carga });
  }
  if (auditoria.confirmacao_fisica !== true || auditoria.confirmacao_texto !== "FECHAR CARGA") return json({ error: "Confirme a contagem física e digite FECHAR CARGA." }, 400);

  const estado = await env.DB.prepare(`
    WITH produtos_carga AS (
      SELECT produto_id FROM estoque_carga_itens WHERE carga_id = ?
      UNION SELECT produto_id FROM estoque_movimentacoes WHERE local_id = (SELECT local_carga_id FROM estoque_cargas WHERE id = ?)
    )
    SELECT carga.id, carga.status, carga.local_carga_id,
      (SELECT id FROM estoque_locais WHERE tipo = 'CENTRAL' AND ativo = 1) AS central_id,
      produto.id AS produto_id, produto.nome AS produto_nome,
      COALESCE((SELECT SUM(quantidade * efeito) FROM estoque_movimentacoes WHERE local_id = carga.local_carga_id AND produto_id = produto.id), 0) AS saldo_atual
    FROM estoque_cargas carga CROSS JOIN produtos_carga pc
    INNER JOIN produtos produto ON produto.id = pc.produto_id
    WHERE carga.id = ? ORDER BY produto.id
  `).bind(cargaId, cargaId, cargaId).all();
  const linhas = estado.results || [];
  const cargaAtual = await env.DB.prepare("SELECT id, status, local_carga_id FROM estoque_cargas WHERE id = ?").bind(cargaId).first();
  if (!cargaAtual) return json({ error: "Carga não encontrada." }, 404);
  if (cargaAtual.status !== "ABERTA") return json({ error: "Somente cargas abertas podem ser fechadas." }, 409);
  const centralId = Number(linhas[0]?.central_id || (await obterEstoqueCentral(env))?.id || 0);
  if (!centralId) return json({ error: "Estoque Central ativo não encontrado." }, 409);
  if (linhas.some(linha => Number(linha.saldo_atual) < 0)) return json({ error: "Há saldo negativo no veículo. Use Conferir saldo antes de fechar." }, 409);
  if (linhas.length !== itens.length || linhas.some((linha, indice) => Number(linha.produto_id) !== itens[indice].produtoId)) return json({ error: "A conferência deve incluir todos os produtos do saldo operacional. Atualize o detalhe da carga." }, 409);
  const divergente = linhas.find((linha, indice) => Number(linha.saldo_atual) !== itens[indice].quantidadeFisica);
  if (divergente) return json({ error: `A quantidade física de ${divergente.produto_nome} difere do saldo sistêmico. Use Conferir saldo antes de fechar.`, produto_id: Number(divergente.produto_id), saldo_atual: Number(divergente.saldo_atual) }, 409);

  const ids = itens.length ? itens.map(item => item.produtoId).join(",") : "0";
  const saldosIguais = itens.map(item => `(EXISTS (SELECT 1 FROM produtos WHERE id = ${item.produtoId}) AND ${item.quantidadeFisica} = (SELECT COALESCE(SUM(quantidade * efeito), 0) FROM estoque_movimentacoes WHERE local_id = carga.local_carga_id AND produto_id = ${item.produtoId}))`).join(" AND ") || "1 = 1";
  const conjuntoExato = `(SELECT COUNT(*) FROM (SELECT produto_id FROM estoque_carga_itens WHERE carga_id = carga.id UNION SELECT produto_id FROM estoque_movimentacoes WHERE local_id = carga.local_carga_id)) = ${itens.length}
    AND NOT EXISTS (SELECT 1 FROM (SELECT produto_id FROM estoque_carga_itens WHERE carga_id = carga.id UNION SELECT produto_id FROM estoque_movimentacoes WHERE local_id = carga.local_carga_id) WHERE produto_id NOT IN (${ids}))`;
  const observacaoAuditoria = `FECHAMENTO_CARGA:${JSON.stringify(auditoria)}`;
  const statements = [env.DB.prepare(`
    INSERT INTO estoque_operacoes (tipo, status, data_operacao, origem_tipo, origem_id, chave_idempotencia, operacao_estornada_id, usuario_id, observacao, created_at)
    SELECT 'RETORNO_CARGA', 'CONFIRMADA', ?, 'CARGA', carga.id, ?, NULL, ?, ?, CURRENT_TIMESTAMP
    FROM estoque_cargas carga
    WHERE carga.id = ? AND carga.status = 'ABERTA' AND carga.local_carga_id = ?
      AND EXISTS (SELECT 1 FROM estoque_locais WHERE id = ? AND tipo = 'CENTRAL' AND ativo = 1)
      AND NOT EXISTS (SELECT 1 FROM estoque_operacoes WHERE chave_idempotencia = ?)
      AND ${conjuntoExato} AND ${saldosIguais}
  `).bind(obterDataLocalCuiaba(), chave, user.vendedorId, observacaoAuditoria, cargaId, cargaAtual.local_carga_id, centralId, chave)];
  for (const item of itens.filter(item => item.quantidadeFisica > 0)) {
    for (const [localId, efeito] of [[Number(cargaAtual.local_carga_id), -1], [centralId, 1]]) statements.push(env.DB.prepare(`
      INSERT INTO estoque_movimentacoes (operacao_id, local_id, produto_id, carga_id, carga_item_id, visita_id, visita_item_id, quantidade, efeito, created_at)
      VALUES (COALESCE((SELECT id FROM estoque_operacoes WHERE chave_idempotencia = ?), 0), ?, ?, ?, (SELECT id FROM estoque_carga_itens WHERE carga_id = ? AND produto_id = ?), NULL, NULL, ?, ?, CURRENT_TIMESTAMP)
    `).bind(chave, localId, item.produtoId, cargaId, cargaId, item.produtoId, item.quantidadeFisica, efeito));
  }
  for (const item of itens) statements.push(env.DB.prepare(`
    UPDATE estoque_carga_itens SET quantidade_retornada = ?,
      quantidade_vendida_fechamento = COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentacoes m INNER JOIN estoque_operacoes o ON o.id = m.operacao_id WHERE m.carga_id = ? AND m.produto_id = ? AND m.efeito = -1 AND o.tipo = 'SAIDA_VENDA' AND o.status = 'CONFIRMADA'), 0),
      saldo_esperado_fechamento = ?, diferenca_fechamento = 0, updated_at = CURRENT_TIMESTAMP
    WHERE carga_id = ? AND produto_id = ? AND EXISTS (SELECT 1 FROM estoque_operacoes WHERE chave_idempotencia = ?)
  `).bind(item.quantidadeFisica, cargaId, item.produtoId, item.quantidadeFisica, cargaId, item.produtoId, chave));
  statements.push(env.DB.prepare(`
    UPDATE estoque_cargas SET status = 'FECHADA', fechada_em = CURRENT_TIMESTAMP, fechada_por = ?, observacoes_fechamento = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'ABERTA' AND EXISTS (SELECT 1 FROM estoque_operacoes WHERE chave_idempotencia = ?)
      AND NOT EXISTS (SELECT 1 FROM estoque_movimentacoes WHERE local_id = estoque_cargas.local_carga_id GROUP BY produto_id HAVING SUM(quantidade * efeito) <> 0)
  `).bind(user.vendedorId, observacao, cargaId, chave));
  statements.push(env.DB.prepare(`
    INSERT INTO estoque_movimentacoes (operacao_id, local_id, produto_id, quantidade, efeito)
    SELECT 0, 0, 0, 0, 0 WHERE NOT EXISTS (
      SELECT 1 FROM estoque_cargas carga INNER JOIN estoque_operacoes operacao ON operacao.origem_id = carga.id
      WHERE carga.id = ? AND carga.status = 'FECHADA' AND operacao.chave_idempotencia = ? AND operacao.tipo = 'RETORNO_CARGA')
  `).bind(cargaId, chave));
  try { await env.DB.batch(statements); }
  catch (err) {
    const concorrente = await carregarFechamentoCargaPorChave(env, chave);
    if (concorrente && fechamentoCargaCompativel(concorrente, cargaId, auditoria)) {
      const carga = await carregarCargaCompleta(env, cargaId);
      if (carga?.status === "FECHADA" && !(await auditarFechamentoCarga(env, cargaId, chave, auditoria))) return json({ success: true, idempotente: true, carga });
    }
    return json({ error: "O estado da carga ou algum saldo mudou. Atualize o detalhe e confira novamente." }, 409);
  }
  const carga = await carregarCargaCompleta(env, cargaId);
  const falhaAuditoria = await auditarFechamentoCarga(env, cargaId, chave, auditoria);
  if (!carga || falhaAuditoria) throw new Error(`Fechamento não confirmado após a transação: ${falhaAuditoria || "carga não encontrada"}`);
  return json({ success: true, idempotente: false, carga }, 201);
}

async function listarVendedores(env, user) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const result = await env.DB.prepare(`
    SELECT id, nome, email, role, status, created_at
    FROM vendedores
    ORDER BY nome
  `).all();

  return json(result.results || []);
}

async function criarVendedor(request, env, user) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const d = await request.json();

  const nome = normalizeText(d.nome);
  const email = normalizeText(d.email).toLowerCase();
  const senha = normalizeText(d.senha || d.senha_hash);
  const role = normalizarRole(d.role || "vendedor");
  const status = normalizeText(d.status || "ativo");

  if (!nome || !email || !senha) {
    return json({ error: "Nome, e-mail e senha são obrigatórios." }, 400);
  }
  if (!rolePermitido(role)) {
    return json({ error: "Perfil inválido. Use admin, vendedor ou operacao." }, 400);
  }

  const existe = await env.DB.prepare(
    "SELECT id FROM vendedores WHERE email = ?"
  ).bind(email).first();

  if (existe) {
    return json({ error: "Já existe vendedor com este e-mail." }, 409);
  }

  const res = await env.DB.prepare(`
    INSERT INTO vendedores (nome, email, senha_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(nome, email, senha, role, status).run();

  return json({
    success: true,
    id: res.meta.last_row_id,
    vendedor: { nome, email, role, status }
  });
}

async function atualizarVendedor(request, env, user, id) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const d = await request.json();

  const atual = await env.DB.prepare(
    "SELECT * FROM vendedores WHERE id = ?"
  ).bind(id).first();

  if (!atual) {
    return json({ error: "Vendedor não encontrado." }, 404);
  }

  const nome = normalizeText(d.nome || atual.nome);
  const email = normalizeText(d.email || atual.email).toLowerCase();
  const senha = normalizeText(d.senha || d.senha_hash || atual.senha_hash);
  const role = normalizarRole(d.role || atual.role || "vendedor");
  const status = normalizeText(d.status || atual.status || "ativo");

  if (!rolePermitido(role)) {
    return json({ error: "Perfil inválido. Use admin, vendedor ou operacao." }, 400);
  }

  await env.DB.prepare(`
    UPDATE vendedores
    SET nome = ?, email = ?, senha_hash = ?, role = ?, status = ?
    WHERE id = ?
  `).bind(nome, email, senha, role, status, id).run();

  return json({
    success: true,
    vendedor: { id, nome, email, role, status }
  });
}

async function debugClientes(request, env, user) {
  if (!usuarioTemRole(user, "admin")) return acessoNegado();
  const url = new URL(request.url);
  const [clientes, vendedores, visitas, listaClientes] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM clientes").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM vendedores").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM visitas").first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM clientes c
      LEFT JOIN vendedores vd ON vd.id = c.vendedor_id
    `).first(),
  ]);

  return json({
    user: {
      id: user.vendedorId,
      role: user.role,
    },
    db: {
      clientes: clientes?.total ?? 0,
      vendedores: vendedores?.total ?? 0,
      visitas: visitas?.total ?? 0,
    },
    consultas: {
      listarClientes: listaClientes?.total ?? 0,
    },
    binding: "DB",
    diagnostico: "debug-clientes-2026-08-01",
    hostname: url.hostname,
    pathname: url.pathname,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

 if (request.method === "OPTIONS") {
  return respostaCors(null, 204);
}

    if (url.pathname === "/" || url.pathname === "/api/health") return health(env);
    if (url.pathname.startsWith("/api/cnpj/") && request.method === "GET") {
  return consultarCNPJ(request);
}
    if (url.pathname === "/api/login" && request.method === "GET") {
      return json({ status: "ok", rota: "/api/login", metodo: "use POST" });
}

    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);

    const user = await getUser(request, env);
    if (!user) return json({ error: "Não autorizado" }, 401);

if (url.pathname === "/api/vendedores" && request.method === "GET") {
  return listarVendedores(env, user);
}

if (url.pathname === "/api/vendedores" && request.method === "POST") {
  return criarVendedor(request, env, user);
}

if (url.pathname.startsWith("/api/vendedores/") && request.method === "PUT") {
  const id = Number(url.pathname.split("/").pop());
  return atualizarVendedor(request, env, user, id);
}

    if (url.pathname === "/api/debug-clientes" && request.method === "GET") return debugClientes(request, env, user);
    if (url.pathname === "/api/clientes" && request.method === "GET") return listarClientes(env, user);
    if (/^\/api\/clientes\/\d+$/.test(url.pathname) && request.method === "GET") {
      return obterClientePorId(env, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/clientes" && request.method === "POST") return criarCliente(request, env, user);
    if (url.pathname === "/api/clientes-avulsos" && request.method === "GET") return listarClientesAvulsos(env);
    if (/^\/api\/clientes-avulsos\/\d+$/.test(url.pathname) && request.method === "GET") {
      return obterClienteAvulsoPorId(env, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/clientes-avulsos" && request.method === "POST") return criarClienteAvulso(request, env, user);
    if (url.pathname === "/api/sync" && request.method === "GET") {
  if (!usuarioTemRole(user, "admin", "vendedor")) return acessoNegado();
  return json({ status: "ok", rota: "/api/sync", metodo: "use POST" });
}

if (url.pathname === "/api/sync" && request.method === "POST") {
  return sync(request, env, user);
}

    if (url.pathname === "/api/produtos" && request.method === "GET") return listarProdutos(request, env, user);
    if (url.pathname === "/api/produtos" && request.method === "POST") return gerirProduto(request, env, user);
    if (url.pathname.startsWith("/api/produtos/") && request.method === "PUT") {
      return await gerirProduto(request, env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/producao/parametros" && request.method === "GET") return listarParametrosProducao(env, user);
    if (/^\/api\/producao\/parametros\/\d+$/.test(url.pathname) && request.method === "PUT") {
      return salvarParametroProducao(request, env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/producao/receitas-base" && request.method === "GET") return listarReceitasBaseProducao(env, user);
    if (url.pathname === "/api/producao/lotes/abertura" && request.method === "POST") return await abrirLoteProducaoV11(request, env, user);
    if (/^\/api\/producao\/lotes\/\d+\/produtos$/.test(url.pathname) && request.method === "POST") {
      return await incluirProdutoLoteV11(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/producao\/lotes\/\d+\/lancamentos$/.test(url.pathname) && request.method === "POST") {
      return await registrarLancamentoLoteV11(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/producao\/lotes\/\d+\/encerramento$/.test(url.pathname) && request.method === "POST") {
      return await encerrarLoteProducaoV11(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (url.pathname === "/api/producao/lotes" && request.method === "POST") return registrarLoteProducao(request, env, user);
    if (url.pathname === "/api/producao/lotes" && request.method === "GET") return listarLotesProducao(request, env, user);
    if (/^\/api\/producao\/lotes\/\d+$/.test(url.pathname) && request.method === "GET") {
      return obterLoteProducao(env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/producao/registros" && request.method === "GET") return listarRegistrosProducao(request, env, user);
    if (url.pathname === "/api/producao/registros" && request.method === "POST") return registrarProducao(request, env, user);
    if (url.pathname === "/api/estoque/central" && request.method === "GET") return consultarEstoqueCentral(env, user);
    if (url.pathname === "/api/estoque/central/inicializar" && request.method === "POST") return inicializarEstoqueCentral(env, user);
    if (url.pathname === "/api/estoque/movimentacoes" && request.method === "GET") return listarMovimentacoesEstoque(request, env, user);
    if (url.pathname === "/api/estoque/inventario-inicial" && request.method === "POST") return registrarInventarioInicial(request, env, user);
    if (url.pathname === "/api/estoque/entradas" && request.method === "POST") return registrarEntradaEstoque(request, env, user);
    if (url.pathname === "/api/estoque/ajustes" && request.method === "POST") return registrarAjusteEstoque(request, env, user);
    if (url.pathname === "/api/estoque/disponibilidade" && request.method === "GET") return consultarDisponibilidadeEstoqueCentral(request, env, user);
    if (url.pathname === "/api/estoque/cargas/vendedores" && request.method === "GET") return listarVendedoresCarga(env, user);
    if (url.pathname === "/api/estoque/cargas" && request.method === "POST") return registrarCargaVendedor(request, env, user);
    if (url.pathname === "/api/estoque/cargas" && request.method === "GET") return listarCargasVendedor(request, env, user);
    if (/^\/api\/estoque\/cargas\/\d+\/complementos$/.test(url.pathname) && request.method === "POST") {
      return registrarComplementoCarga(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/estoque\/cargas\/\d+\/cancelamento$/.test(url.pathname) && request.method === "POST") {
      return cancelarCargaVendedor(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/estoque\/cargas\/\d+\/conferencia$/.test(url.pathname) && request.method === "POST") {
      return registrarConferenciaCarga(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/estoque\/cargas\/\d+\/fechamento$/.test(url.pathname) && request.method === "POST") {
      return fecharCargaVendedor(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (/^\/api\/estoque\/cargas\/\d+$/.test(url.pathname) && request.method === "GET") {
      return obterCargaVendedor(env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/estoque/vendas-sem-baixa" && request.method === "GET") return listarVendasSemBaixa(request, env, user);
    if (/^\/api\/estoque\/vendas-sem-baixa\/\d+\/conciliacao$/.test(url.pathname) && request.method === "POST") {
      return conciliarVendaSemBaixa(request, env, user, Number(url.pathname.split("/")[4]));
    }
    if (url.pathname === "/api/visitas" && request.method === "GET") return listarVisitas(request, env, user);
    if (url.pathname === "/api/visitas" && request.method === "POST") return criarVenda(request, env, user);
    if (url.pathname.startsWith("/api/admin/visitas/") && request.method === "PUT") {
      return atualizarVisitaAdmin(request, env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname.startsWith("/api/admin/visitas/") && request.method === "DELETE") {
      return excluirVisitaAdmin(request, env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/relatorio-testes" && request.method === "GET") return relatorioPeriodo(request, env, user, true);
    if (url.pathname === "/api/relatorio-dia" && request.method === "GET") return relatorioPeriodo(request, env, user, false);
    return json({ error: "Rota não encontrada" }, 404);
    } catch (err) {
      return json({
        error: "Erro interno no Worker",
        detalhe: err.message,
      }, 500);
    }
  },
};
