(function(global){
  const EMPRESA={
    razaoSocial:"Odir B. da Silva - ME",
    nomeFantasia:"Vovó Maria Pães e Biscoitos",
    cnpj:"24.256.043/0001-09",
    endereco:"Rua Marconi, 109 - Campo Velho",
    cidade:"Cuiabá - MT",
    whatsapp:"(65) 99994-4918",
    instagram:"@vovomariapaesebiscoitos"
  };
  const escapar=valor=>String(valor??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const rotuloForma=forma=>({dinheiro:"Dinheiro",pix:"Pix",cartao:"Cartão",prazo:"Prazo",boleto:"Boleto"}[String(forma||"").toLowerCase()]||String(forma||"Não informado"));
  function dataHora(valor,dataAlternativa){
    const texto=String(valor||"").trim();let data=null;
    if(texto){const horarioD1=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto);const normalizado=horarioD1?`${texto.replace(" ","T")}Z`:texto;const candidata=new Date(normalizado);if(!Number.isNaN(candidata.getTime()))data=candidata}else data=new Date();
    const dataVenda=String(dataAlternativa||"");
    const local=data?obterDataHoraLocalCuiaba(data):null;return {data:dataVenda?dataVenda.split("-").reverse().join("/"):(local?local.data.split("-").reverse().join("/"):"Não informada"),hora:local?local.hora:"Não informada"};
  }
  function criarComprovante(venda,dinheiro){
    const itens=Array.isArray(venda.itens)?venda.itens:[],pagamentos=Array.isArray(venda.pagamentos)?venda.pagamentos:[];
    const subtotal=Number(venda.subtotal??itens.reduce((s,i)=>s+Number(i.subtotal??Number(i.quantidade||0)*Number(i.preco_unitario||0)),0));
    const desconto=Number(venda.desconto||0),total=Number(venda.valor_total??Math.max(0,subtotal-desconto)),recebido=Number(venda.valor_recebido??pagamentos.filter(p=>String(p.forma).toLowerCase()!=="prazo").reduce((s,p)=>s+Number(p.valor||0),0)),pendente=Math.max(0,total-recebido);
    const quando=dataHora(venda.created_at,venda.data_visita),situacao=String(venda.situacao_pagamento||"pendente").toLowerCase();
    const linhasPagamento=pagamentos.length?pagamentos:([{forma:venda.forma_pagamento||"Não informado",valor:recebido}]);
    return `<div class="comprovante">
      <header class="comprovante-cabecalho"><div class="comprovante-logo"><img src="images/logo-vovo-maria.png" alt="Logo comercial Vovó Maria Pães e Biscoitos" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span class="comprovante-logo-fallback">Vovó Maria<br>Pães e Biscoitos</span></div><div class="comprovante-empresa"><div class="comprovante-razao">${EMPRESA.razaoSocial}</div><div class="comprovante-fantasia">${EMPRESA.nomeFantasia}</div><div>CNPJ: ${EMPRESA.cnpj}</div><div>${EMPRESA.endereco}</div><div>${EMPRESA.cidade}</div><div>WhatsApp: ${EMPRESA.whatsapp}</div><div>Instagram: ${EMPRESA.instagram}</div></div></header>
      <section class="comprovante-titulo"><h2>COMPROVANTE DE COMPRA</h2><div class="comprovante-identificacao"><strong>Venda nº ${escapar(venda.visita_id??venda.id)}</strong><span>Data: ${escapar(quando.data)}</span><span>Hora: ${escapar(quando.hora)}</span></div></section>
      <section class="comprovante-secao"><h3>Dados da venda</h3><div class="comprovante-dados"><div><strong>Cliente:</strong> ${escapar(venda.cliente||venda.cliente_nome||"Consumidor")}</div><div><strong>Vendedor:</strong> ${escapar(venda.vendedor||venda.vendedor_nome||"Vendedor")}</div>${venda.documento_cliente?`<div><strong>CNPJ/CPF:</strong> ${escapar(venda.documento_cliente)}</div>`:""}${venda.forma_atendimento?`<div><strong>Atendimento:</strong> ${escapar(venda.forma_atendimento)}</div>`:""}${venda.observacoes?`<div class="linha-inteira comprovante-observacao"><strong>Observações:</strong> ${escapar(venda.observacoes)}</div>`:""}</div></section>
      <section class="comprovante-secao"><h3>Produtos</h3><table class="comprovante-tabela"><thead><tr><th>Produto</th><th class="numero">Quantidade</th><th class="numero">Valor unitário</th><th class="numero">Valor total</th></tr></thead><tbody>${itens.map(i=>`<tr><td>${escapar(i.produto_nome)}</td><td class="numero">${escapar(i.quantidade)}</td><td class="numero">${dinheiro(i.preco_unitario)}</td><td class="numero">${dinheiro(i.subtotal??Number(i.quantidade||0)*Number(i.preco_unitario||0))}</td></tr>`).join("")||'<tr><td colspan="4">Itens não disponíveis.</td></tr>'}</tbody></table></section>
      <section class="comprovante-secao comprovante-financeiro"><div class="comprovante-resumo"><h3>Resumo financeiro</h3><div class="comprovante-valor"><span>Subtotal</span><strong>${dinheiro(subtotal)}</strong></div><div class="comprovante-valor"><span>Desconto</span><strong>${dinheiro(desconto)}</strong></div><div class="comprovante-valor"><span>Total bruto</span><strong>${dinheiro(subtotal)}</strong></div><div class="comprovante-valor comprovante-total"><span>TOTAL DA COMPRA</span><strong>${dinheiro(total)}</strong></div><div class="comprovante-valor"><span>Valor recebido</span><strong>${dinheiro(recebido)}</strong></div><div class="comprovante-valor"><span>Valor pendente</span><strong>${dinheiro(pendente)}</strong></div></div><div class="comprovante-pagamentos"><h3>Formas de pagamento</h3>${linhasPagamento.map(p=>`<div class="comprovante-valor"><span>${escapar(rotuloForma(p.forma))}</span><strong>${dinheiro(p.valor)}</strong></div>`).join("")}<div class="comprovante-situacao ${escapar(situacao)}">${escapar(situacao.toUpperCase())}</div></div></section>
      <footer class="comprovante-rodape"><strong>Obrigado pela preferência!</strong><div>${EMPRESA.nomeFantasia}</div><div>WhatsApp: ${EMPRESA.whatsapp} · Instagram: ${EMPRESA.instagram}</div><div class="comprovante-aviso">Este comprovante não substitui documento fiscal.</div></footer>
    </div>`;
  }
  function textoComprovante(venda,dinheiro){
    const itens=Array.isArray(venda.itens)?venda.itens:[],pagamentos=Array.isArray(venda.pagamentos)?venda.pagamentos:[];const subtotal=Number(venda.subtotal??itens.reduce((s,i)=>s+Number(i.subtotal||0),0)),desconto=Number(venda.desconto||0),total=Number(venda.valor_total??subtotal-desconto),recebido=Number(venda.valor_recebido??pagamentos.filter(p=>String(p.forma).toLowerCase()!=="prazo").reduce((s,p)=>s+Number(p.valor||0),0)),quando=dataHora(venda.created_at,venda.data_visita);
    return [EMPRESA.nomeFantasia,"COMPROVANTE DE COMPRA",`Venda nº ${venda.visita_id??venda.id}`,`Data: ${quando.data} | Hora: ${quando.hora}`,`Cliente: ${venda.cliente||venda.cliente_nome||"Consumidor"}`,`Vendedor: ${venda.vendedor||venda.vendedor_nome||"Vendedor"}`,venda.observacoes?`Observações: ${venda.observacoes}`:"","",...itens.map(i=>`${i.produto_nome} | ${i.quantidade} × ${dinheiro(i.preco_unitario)} = ${dinheiro(i.subtotal)}`),"",`Subtotal: ${dinheiro(subtotal)}`,`Desconto: ${dinheiro(desconto)}`,`TOTAL DA COMPRA: ${dinheiro(total)}`,`Recebido: ${dinheiro(recebido)}`,`Pendente: ${dinheiro(Math.max(0,total-recebido))}`,"Pagamentos:",...(pagamentos.length?pagamentos:[{forma:venda.forma_pagamento||"Não informado",valor:recebido}]).map(p=>`${rotuloForma(p.forma)}: ${dinheiro(p.valor)}`),`Situação: ${String(venda.situacao_pagamento||"pendente").toUpperCase()}`,"","Obrigado pela preferência!",`WhatsApp: ${EMPRESA.whatsapp}`,`Instagram: ${EMPRESA.instagram}`,"Este comprovante não substitui documento fiscal."].filter(Boolean).join("\n");
  }
  const cachePdfVisual=new WeakMap();
  const obterComprovante=origem=>origem?.classList?.contains("comprovante")?origem:origem?.querySelector?.(".comprovante");
  async function gerarArquivoPdfVisual(comprovante,nomeArquivo){
    if(typeof global.html2canvas!=="function"||!global.jspdf?.jsPDF)throw new Error("Os recursos de geração do PDF visual não foram carregados.");
    await aguardarRecursosImpressao(global);
    const canvas=await global.html2canvas(comprovante,{backgroundColor:"#ffffff",scale:Math.max(2,Math.min(3,global.devicePixelRatio||2)),useCORS:true,logging:false,imageTimeout:8000,removeContainer:true});
    const {jsPDF}=global.jspdf,pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a5",compress:true});
    const margem=7,larguraPagina=148,alturaPagina=210,larguraUtil=larguraPagina-margem*2,alturaUtil=alturaPagina-margem*2;
    const alturaFatia=Math.max(1,Math.floor(canvas.width*alturaUtil/larguraUtil));
    let topo=0,pagina=0;
    while(topo<canvas.height){
      const altura=Math.min(alturaFatia,canvas.height-topo),fatia=document.createElement("canvas");
      fatia.width=canvas.width;fatia.height=altura;
      const contexto=fatia.getContext("2d");contexto.fillStyle="#fff";contexto.fillRect(0,0,fatia.width,fatia.height);contexto.drawImage(canvas,0,topo,canvas.width,altura,0,0,canvas.width,altura);
      if(pagina++)pdf.addPage("a5","portrait");
      pdf.addImage(fatia.toDataURL("image/jpeg",0.96),"JPEG",margem,margem,larguraUtil,altura*larguraUtil/canvas.width,undefined,"FAST");
      topo+=altura;
    }
    return new File([pdf.output("arraybuffer")],nomeArquivo,{type:"application/pdf"});
  }
  function gerarPdfComprovante(venda,dinheiro,origem){
    const comprovante=obterComprovante(origem),numero=venda?.visita_id??venda?.id??"sem-numero",nome=`comprovante-venda-${numero}.pdf`;
    if(!comprovante)return Promise.reject(new Error("Comprovante visual não encontrado."));
    const existente=cachePdfVisual.get(comprovante);if(existente?.numero===String(numero))return existente.promessa;
    const promessa=gerarArquivoPdfVisual(comprovante,nome).catch(erro=>{cachePdfVisual.delete(comprovante);throw erro});
    cachePdfVisual.set(comprovante,{numero:String(numero),promessa});return promessa;
  }
  function prepararPdfComprovante(venda,dinheiro,origem){return gerarPdfComprovante(venda,dinheiro,origem).catch(()=>null)}
  function baixarArquivo(arquivo){const url=URL.createObjectURL(arquivo),link=document.createElement("a");link.href=url;link.download=arquivo.name;link.hidden=true;document.body.appendChild(link);link.click();link.remove();global.setTimeout(()=>URL.revokeObjectURL(url),30000)}
  async function compartilharComprovantePdf(venda,dinheiro,origem){
    const arquivo=await gerarPdfComprovante(venda,dinheiro,origem),dados={files:[arquivo],title:"Comprovante de compra",text:`Comprovante da venda nº ${venda?.visita_id??venda?.id??""}`};
    if(global.navigator?.share&&global.navigator?.canShare?.({files:[arquivo]})){try{await global.navigator.share(dados);return {compartilhado:true,arquivo}}catch(erro){if(erro?.name==="AbortError")return {cancelado:true,arquivo}}}
    baixarArquivo(arquivo);return {baixado:true,arquivo};
  }
  function aguardar(ms){return new Promise(resolve=>global.setTimeout(resolve,ms))}
  function proximoFrame(janela=global){return new Promise(resolve=>{if(janela.requestAnimationFrame)janela.requestAnimationFrame(()=>resolve());else if(global.requestAnimationFrame)global.requestAnimationFrame(()=>resolve());else global.setTimeout(resolve,16)})}
  async function aguardarRecursosImpressao(janela){
    const doc=janela.document,folha=doc.getElementById("estiloComprovante");
    if(folha&&!folha.sheet)await Promise.race([new Promise(resolve=>{folha.addEventListener("load",resolve,{once:true});folha.addEventListener("error",resolve,{once:true})}),aguardar(4000)]);
    const imagens=[...doc.images].filter(imagem=>!imagem.complete).map(imagem=>new Promise(resolve=>{imagem.addEventListener("load",resolve,{once:true});imagem.addEventListener("error",resolve,{once:true})}));
    if(imagens.length)await Promise.race([Promise.all(imagens),aguardar(4000)]);
    if(doc.fonts?.ready)await Promise.race([doc.fonts.ready.catch(()=>{}),aguardar(2000)]);
    await proximoFrame(janela);await proximoFrame(janela);await aguardar(100);
  }
  function imprimirComClone(comprovante){
    document.getElementById("areaImpressaoComprovante")?.remove();
    const area=document.createElement("div");area.id="areaImpressaoComprovante";area.appendChild(comprovante.cloneNode(true));document.body.appendChild(area);document.body.classList.add("imprimindo-comprovante");
    let finalizado=false;const finalizar=()=>{if(finalizado)return;finalizado=true;document.body.classList.remove("imprimindo-comprovante");area.remove();global.removeEventListener?.("afterprint",finalizar)};
    global.addEventListener?.("afterprint",finalizar,{once:true});
    proximoFrame().then(()=>proximoFrame()).then(()=>aguardar(100)).then(()=>global.print()).catch(finalizar);
  }
  function ambienteAndroidOuPWA(){
    const android=/Android/i.test(global.navigator?.userAgent||"");
    const pwa=global.matchMedia?.("(display-mode: standalone)")?.matches===true||global.navigator?.standalone===true;
    return android||pwa;
  }
  function imprimirComprovanteExistente(comprovante){
    const preservados=[];let atual=comprovante;
    comprovante.classList.add("comprovante-em-impressao");
    while(atual&&atual!==document.body){atual.classList.add("manter-na-impressao");preservados.push(atual);atual=atual.parentElement}
    document.body.classList.add("imprimindo-comprovante-movel");
    let finalizado=false;const finalizar=()=>{if(finalizado)return;finalizado=true;document.body.classList.remove("imprimindo-comprovante-movel");comprovante.classList.remove("comprovante-em-impressao");preservados.forEach(elemento=>elemento.classList.remove("manter-na-impressao"));global.removeEventListener?.("afterprint",finalizar)};
    global.addEventListener?.("afterprint",finalizar,{once:true});
    proximoFrame().then(()=>proximoFrame()).then(()=>aguardar(100)).then(()=>global.print()).catch(finalizar);
  }
  async function prepararJanelaImpressao(janela,comprovante){
    const base=String(document.baseURI||global.location?.href||"").replace(/"/g,"&quot;"),css=new URL("comprovante.css",document.baseURI).href.replace(/"/g,"&quot;");
    janela.document.open();janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${base}"><title>Comprovante de Compra</title><link id="estiloComprovante" rel="stylesheet" href="${css}"><style>@page{size:A5 portrait;margin:7mm}html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}body{width:134mm}.comprovante{width:134mm!important;max-width:134mm!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.comprovante-acoes{display:none!important}@media print{html,body{width:134mm!important;min-height:0!important}.comprovante{page:auto!important}}</style></head><body>${comprovante.outerHTML}</body></html>`);janela.document.close();
    await aguardarRecursosImpressao(janela);janela.focus();
    let fechada=false;const fechar=()=>{if(fechada)return;fechada=true;try{janela.close()}catch{}};janela.addEventListener?.("afterprint",fechar,{once:true});global.setTimeout(fechar,120000);janela.print();
  }
  function imprimirComprovante(origem){
    const comprovante=origem?.classList?.contains("comprovante")?origem:origem?.querySelector?.(".comprovante");
    if(!comprovante)return;
    if(ambienteAndroidOuPWA()){imprimirComprovanteExistente(comprovante);return}
    const janela=global.open?.("","_blank");
    if(!janela){imprimirComClone(comprovante);return}
    prepararJanelaImpressao(janela,comprovante).catch(()=>{try{janela.close()}catch{}imprimirComClone(comprovante)});
  }
  global.EMPRESA_COMPROVANTE=EMPRESA;global.criarComprovante=criarComprovante;global.textoComprovante=textoComprovante;global.gerarPdfComprovante=gerarPdfComprovante;global.prepararPdfComprovante=prepararPdfComprovante;global.compartilharComprovantePdf=compartilharComprovantePdf;global.imprimirComprovante=imprimirComprovante;
})(globalThis);
