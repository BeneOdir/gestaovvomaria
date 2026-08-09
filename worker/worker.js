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
      WHERE v.data_visita = ? AND ${filtroRegistroTeste("v")}
      ORDER BY v.id DESC
    `).bind(data).all();
  } else {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND ${filtroRegistroTeste("v")}
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
    WHERE data_visita = ?${filtroVendedor} AND ${filtroRegistroTeste("v")}
  `).bind(...params).first();

  const itens = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade),0) AS quantidade, COALESCE(SUM(vi.subtotal),0) AS total
    FROM visita_itens vi
    INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita = ?${user.role === "admin" ? "" : " AND v.vendedor_id = ?"}
      AND ${filtroRegistroTeste("v")}
    GROUP BY vi.produto_nome
    ORDER BY quantidade DESC
  `).bind(...params).all();

  const visitas = await (user.role === "admin"
    ? env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data).all()
    : env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all());

  return json({ data, resumo, produtos: itens.results || [], visitas: visitas.results || [] });
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
  const itensEntrada = Array.isArray(d.itens)
    ? d.itens
    : (Array.isArray(d.produtos) ? d.produtos : []);

  if (!canalVenda) return json({ error: "Canal da venda inválido. Use ROTA ou LOJA_FABRICA." }, 400);
  if (!user?.vendedorId) return json({ error: "Vendedor autenticado não identificado." }, 401);
  if ((!clienteId && !clienteAvulsoId) || (clienteId && clienteAvulsoId)) {
    return json({ error: "Selecione exatamente um cliente cadastrado ou avulso." }, 400);
  }
  if (!Number.isFinite(desconto) || desconto < 0) return json({ error: "Desconto inválido." }, 400);

  const cliente = clienteId
    ? await env.DB.prepare("SELECT id, nome_fantasia, razao_social, nome_estabelecimento FROM clientes WHERE id = ?").bind(clienteId).first()
    : await env.DB.prepare("SELECT id, nome_estabelecimento FROM clientes_avulsos WHERE id = ?").bind(clienteAvulsoId).first();
  if (!cliente) return json({ error: "Cliente não encontrado." }, 404);

  const itens = itensEntrada.map(item => {
    const quantidade = Number(item.quantidade);
    const precoUnitario = Number(item.preco_unitario);
    return {
      produto_id: Number(item.produto_id || 0) || null,
      produto_nome: normalizeText(item.produto_nome),
      quantidade,
      preco_unitario: precoUnitario,
      subtotal: quantidade * precoUnitario
    };
  }).filter(item => item.produto_id || item.produto_nome || item.quantidade || item.preco_unitario);

  if (comprou === "sim" && !itens.length) return json({ error: "Adicione ao menos um produto." }, 400);
  if (itens.some(item => !item.produto_nome || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.preco_unitario) || item.preco_unitario < 0)) {
    return json({ error: "Todos os itens devem ter produto, quantidade maior que zero e preço não negativo." }, 400);
  }

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

  const visitaRes = await env.DB.prepare(`
    INSERT INTO visitas (
      vendedor_id, cliente_id, cliente_avulso_id, data_visita, canal_venda, comprou,
      valor_total, observacoes, forma_pagamento, valor_recebido, desconto,
      situacao_pagamento, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(user.vendedorId, clienteId || 0, clienteAvulsoId || null, dataVisita, canalVenda, comprou,
    valorTotal, observacoes, formaPagamento, valorRecebido, desconto, situacaoPagamento).run();
  const visitaId = visitaRes.meta.last_row_id;

  try {
    const gravacoes = [
      ...itens.map(item => env.DB.prepare(`
        INSERT INTO visita_itens (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(visitaId, item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal)),
      ...pagamentos.map(pagamento => env.DB.prepare(`
        INSERT INTO visita_pagamentos (visita_id, forma_pagamento, valor, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(visitaId, pagamento.forma, pagamento.valor))
    ];
    if (gravacoes.length) await env.DB.batch(gravacoes);
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM visita_pagamentos WHERE visita_id = ?").bind(visitaId).run();
    } catch {}
    await env.DB.batch([
      env.DB.prepare("DELETE FROM visita_itens WHERE visita_id = ?").bind(visitaId),
      env.DB.prepare("DELETE FROM visitas WHERE id = ?").bind(visitaId)
    ]);
    throw err;
  }

  if (clienteId) {
    await env.DB.prepare("UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(dataVisita, clienteId).run();
  }

  let createdAt = null;
  try {
    const vendaSalva = await env.DB.prepare("SELECT created_at FROM visitas WHERE id = ?").bind(visitaId).first();
    createdAt = vendaSalva?.created_at || null;
  } catch {}

  return json({
    success: true, visita_id: visitaId, data_visita: dataVisita, canal_venda: canalVenda, created_at: createdAt,
    cliente: cliente.nome_fantasia || cliente.razao_social || cliente.nome_estabelecimento || "Consumidor",
    vendedor: user.nome || "Vendedor", itens, subtotal, desconto,
    valor_total: valorTotal, valor_recebido: valorRecebido,
    forma_pagamento: formaPagamento, pagamentos, situacao_pagamento: situacaoPagamento
  });
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
  if (!['geral', 'vendedor'].includes(visaoSolicitada)) return json({ error: "Visão de relatório inválida." }, 400);
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
  if (user.role === "admin" && visao === "geral" && origem === "administracao") filtro += " AND EXISTS (SELECT 1 FROM vendedores vo WHERE vo.id = v.vendedor_id AND vo.role = 'admin')";
  if (user.role === "admin" && visao === "geral" && origem === "vendedores") filtro += " AND EXISTS (SELECT 1 FROM vendedores vo WHERE vo.id = v.vendedor_id AND vo.role = 'vendedor')";
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

  const resumoVendedores = user.role === "admin" && visao === "geral"
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
    produtos: produtos.results || [], visitas: vendasDetalhadas });
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

    const visita = await env.DB.prepare("SELECT id, comprou FROM visitas WHERE id = ?").bind(id).first();
    if (!visita) return json({ error: "Visita não encontrada." }, 404);

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
    if (dados.confirmacao !== "EXCLUIR") return json({ error: "Digite EXCLUIR para confirmar." }, 400);

    const visita = await env.DB.prepare("SELECT * FROM visitas WHERE id = ?").bind(id).first();
    if (!visita) return json({ error: "Visita não encontrada." }, 404);
    if (!await confirmarSenhaAdministrador(env, user, dados.senha)) {
      return json({ error: "Senha do administrador inválida." }, 401);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM visita_itens WHERE visita_id = ?").bind(id),
      env.DB.prepare("DELETE FROM visitas WHERE id = ?").bind(id),
    ]);

    const [visitaRestante, itensRestantes] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM visitas WHERE id = ?").bind(id).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM visita_itens WHERE visita_id = ?").bind(id).first(),
    ]);
    if (Number(visitaRestante?.total || 0) !== 0 || Number(itensRestantes?.total || 0) !== 0) {
      return json({ error: "Não foi possível confirmar a exclusão completa." }, 500);
    }

    return json({ ok: true, mensagem: "Venda excluída definitivamente.", visita_id: id });
  } catch (err) {
    return json({ error: "Erro ao excluir visita.", detalhe: err?.message || String(err) }, 500);
  }
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
    if (url.pathname === "/api/producao/registros" && request.method === "GET") return listarRegistrosProducao(request, env, user);
    if (url.pathname === "/api/producao/registros" && request.method === "POST") return registrarProducao(request, env, user);
    if (url.pathname === "/api/estoque/central" && request.method === "GET") return consultarEstoqueCentral(env, user);
    if (url.pathname === "/api/estoque/central/inicializar" && request.method === "POST") return inicializarEstoqueCentral(env, user);
    if (url.pathname === "/api/estoque/movimentacoes" && request.method === "GET") return listarMovimentacoesEstoque(request, env, user);
    if (url.pathname === "/api/estoque/inventario-inicial" && request.method === "POST") return registrarInventarioInicial(request, env, user);
    if (url.pathname === "/api/estoque/entradas" && request.method === "POST") return registrarEntradaEstoque(request, env, user);
    if (url.pathname === "/api/estoque/ajustes" && request.method === "POST") return registrarAjusteEstoque(request, env, user);
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
