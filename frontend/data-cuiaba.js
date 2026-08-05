(function(global){
  const FUSO_CUIABA="America/Cuiaba";
  const formatadorData=new Intl.DateTimeFormat("en-US",{timeZone:FUSO_CUIABA,year:"numeric",month:"2-digit",day:"2-digit"});
  const formatadorHora=new Intl.DateTimeFormat("pt-BR",{timeZone:FUSO_CUIABA,hour:"2-digit",minute:"2-digit",hour12:false});
  const formatadorSemana=new Intl.DateTimeFormat("en-US",{timeZone:FUSO_CUIABA,weekday:"short"});
  function partesData(instante=new Date()){
    const partes=Object.fromEntries(formatadorData.formatToParts(instante).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
    return {ano:partes.year,mes:partes.month,dia:partes.day};
  }
  function obterDataLocalCuiaba(instante=new Date()){
    const {ano,mes,dia}=partesData(instante);return `${ano}-${mes}-${dia}`;
  }
  function obterDataHoraLocalCuiaba(instante=new Date()){
    return {data:obterDataLocalCuiaba(instante),hora:formatadorHora.format(instante)};
  }
  function obterDiaSemanaCuiaba(instante=new Date()){
    return {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[formatadorSemana.format(instante)];
  }
  function somarDiasCuiaba(dataISO,dias){
    const instante=new Date(`${dataISO}T12:00:00-04:00`);instante.setTime(instante.getTime()+Number(dias)*86400000);return obterDataLocalCuiaba(instante);
  }
  function primeiroDiaMesCuiaba(dataISO){return `${String(dataISO).slice(0,7)}-01`}
  function ultimoDiaMesCuiaba(dataISO){
    const [ano,mes]=String(dataISO).split("-").map(Number);const bissexto=ano%4===0&&(ano%100!==0||ano%400===0);const dias=[31,bissexto?29:28,31,30,31,30,31,31,30,31,30,31];return `${ano}-${String(mes).padStart(2,"0")}-${dias[mes-1]}`;
  }
  global.FUSO_CUIABA=FUSO_CUIABA;global.obterDataLocalCuiaba=obterDataLocalCuiaba;global.obterDataHoraLocalCuiaba=obterDataHoraLocalCuiaba;global.obterDiaSemanaCuiaba=obterDiaSemanaCuiaba;global.somarDiasCuiaba=somarDiasCuiaba;global.primeiroDiaMesCuiaba=primeiroDiaMesCuiaba;global.ultimoDiaMesCuiaba=ultimoDiaMesCuiaba;
})(globalThis);
