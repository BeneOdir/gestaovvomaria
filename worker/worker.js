const JWT_SECRET = "vovomaria_mvp_2026_trocar_depois";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function onlyNumbers(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function normalizeText(v = "") {
  return String(v || "").trim();
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

async function getUser(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    return await jwtVerify(auth.replace("Bearer ", ""));
  } catch {
    return null;
  }
}

async function login(request, env) {
  const { email, senha } = await request.json();

  const vendedor = await env.DB.prepare(
    "SELECT id, nome, email, senha_hash, role, status FROM vendedores WHERE email = ?"
  ).bind(normalizeText(email)).first();

  if (!vendedor || vendedor.status === "inativo" || senha !== vendedor.senha_hash) {
    return json({ error: "Credenciais inválidas" }, 401);
  }

  const token = await jwtSign({
    vendedorId: vendedor.id,
    nome: vendedor.nome,
    role: vendedor.role || "vendedor",
  });

  return json({
    token,
    vendedor: {
      id: vendedor.id,
      nome: vendedor.nome,
      email: vendedor.email,
      role: vendedor.role || "vendedor",
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
  let result;
  if (user.role === "admin") {
    result = await env.DB.prepare("SELECT * FROM clientes ORDER BY id DESC").all();
  } else {
    result = await env.DB.prepare(
      "SELECT * FROM clientes WHERE vendedor_id = ? ORDER BY id DESC"
    ).bind(user.vendedorId).all();
  }
  return json(result.results || []);
}

async function criarCliente(request, env, user) {
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

async function sync(request, env, user) {
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

async function listarProdutos(env) {
  const result = await env.DB.prepare(
    "SELECT * FROM produtos WHERE ativo <> 'inativo' ORDER BY nome"
  ).all();

  return json(result.results || []);
}

async function criarVisita(request, env, user) {
  try {
    const d = await request.json();
    const clienteId = Number(d.cliente_id || 0);
    const dataVisita = normalizeText(d.data_visita || new Date().toISOString().slice(0,10));
    const comprou = d.comprou === "sim" || d.comprou === true ? "sim" : "nao";
    const observacoes = normalizeText(d.observacoes);
    const itens = Array.isArray(d.itens) ? d.itens : [];

    if (!clienteId) return json({ error: "Selecione um cliente." }, 400);

    const cliente = await env.DB.prepare("SELECT id, nome_fantasia, razao_social, vendedor_id FROM clientes WHERE id = ?").bind(clienteId).first();
    if (!cliente) return json({ error: "Cliente não encontrado." }, 404);
    if (user.role !== "admin" && Number(cliente.vendedor_id) !== Number(user.vendedorId)) {
      return json({ error: "Cliente não pertence a este vendedor." }, 403);
    }

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
      INSERT INTO visitas (vendedor_id, cliente_id, data_visita, comprou, valor_total, observacoes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(user.vendedorId, clienteId, dataVisita, comprou, valorTotal, observacoes).run();

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
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || new Date().toISOString().slice(0,10);
  let result;
  if (user.role === "admin") {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ?
      ORDER BY v.id DESC
    `).bind(data).all();
  } else {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ?
      ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all();
  }
  return json(result.results || []);
}

async function relatorioDia(request, env, user) {
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || new Date().toISOString().slice(0,10);
  const filtroVendedor = user.role === "admin" ? "" : " AND vendedor_id = ?";
  const params = user.role === "admin" ? [data] : [data, user.vendedorId];

  const resumo = await env.DB.prepare(`
    SELECT
      COUNT(*) AS visitas,
      SUM(CASE WHEN comprou = 'sim' THEN 1 ELSE 0 END) AS compras,
      SUM(CASE WHEN comprou = 'nao' THEN 1 ELSE 0 END) AS sem_compra,
      COALESCE(SUM(valor_total), 0) AS valor_total
    FROM visitas
    WHERE data_visita = ?${filtroVendedor}
  `).bind(...params).first();

  const itens = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade),0) AS quantidade, COALESCE(SUM(vi.subtotal),0) AS total
    FROM visita_itens vi
    INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita = ?${user.role === "admin" ? "" : " AND v.vendedor_id = ?"}
    GROUP BY vi.produto_nome
    ORDER BY quantidade DESC
  `).bind(...params).all();

  const visitas = await (user.role === "admin"
    ? env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? ORDER BY v.id DESC
    `).bind(data).all()
    : env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all());

  return json({ data, resumo, produtos: itens.results || [], visitas: visitas.results || [] });
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
  const role = normalizeText(d.role || "vendedor");
  const status = normalizeText(d.status || "ativo");

  if (!nome || !email || !senha) {
    return json({ error: "Nome, e-mail e senha são obrigatórios." }, 400);
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
  const role = normalizeText(d.role || atual.role || "vendedor");
  const status = normalizeText(d.status || atual.status || "ativo");

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
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

 if (request.method === "OPTIONS") {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

    if (url.pathname === "/" || url.pathname === "/api/health") return health(env);
    if (url.pathname.startsWith("/api/cnpj/") && request.method === "GET") {
  return consultarCNPJ(request);
}
    if (url.pathname === "/api/login" && request.method === "GET") {
      return json({ status: "ok", rota: "/api/login", metodo: "use POST" });
}

    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);

    const user = await getUser(request);
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

    if (url.pathname === "/api/clientes" && request.method === "GET") return listarClientes(env, user);
    if (url.pathname === "/api/clientes" && request.method === "POST") return criarCliente(request, env, user);
    if (url.pathname === "/api/sync" && request.method === "GET") {
  return json({ status: "ok", rota: "/api/sync", metodo: "use POST" });
}

if (url.pathname === "/api/sync" && request.method === "POST") {
  return sync(request, env, user);
}

    if (url.pathname === "/api/produtos" && request.method === "GET") return listarProdutos(env);
    if (url.pathname === "/api/visitas" && request.method === "GET") return listarVisitas(request, env, user);
    if (url.pathname === "/api/visitas" && request.method === "POST") return criarVisita(request, env, user);
    if (url.pathname === "/api/relatorio-dia" && request.method === "GET") return relatorioDia(request, env, user);
    return json({ error: "Rota não encontrada" }, 404);
  },
};
