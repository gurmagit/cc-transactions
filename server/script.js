const tbody = document.getElementById('tbody');
const from = document.getElementById('from');
const to = document.getElementById('to');
const root = document.querySelector(':root');
const card_list = document.getElementById('cards');
const link = document.getElementById('link');
const table_headings = document.querySelectorAll('thead th');
const amount_col = getColumnByValue('Amount');
const num_col = getColumnByValue('Card Number');
const date_col = getColumnByValue('Date');
const search = document.querySelector('input[type=search]');
const submit_params = document.querySelector('input[type=button]');
const select_all = document.querySelector('input[name=select-all]');
search.addEventListener('input', ()=>filterTable(true));
submit_params.addEventListener('click', () => fetchData(true));
from.addEventListener('input', () => filterTable('date-from'));
to.addEventListener('input', () => filterTable('date-to'));
card_list.addEventListener('input', () => filterTable());
link.addEventListener;
select_all.addEventListener('change', e => {
  if (e.target.checked) filterTable(true);
})
let table_rows;
let cards_data;

window.onload = () => {
  fetchData(false);
}

function fetchData(fresh_data) {
  const cardsData = localStorage.getItem('cardsData');
  if (cardsData == null || fresh_data) {
    const days = parseInt(document.getElementById('days').value) || 11;
    const months = parseInt(document.getElementById('months').value) || 1;
    const url = 'http://localhost:3010/cards?days='+days+'&months='+months;
    fetch(url).then(res => {
      return res.json();
    }).then(objectData => {
      createTable(objectData);
      localStorage.setItem('cardsData', JSON.stringify(objectData));
    })
    .catch(console.error);
  } else {
    createTable(JSON.parse(cardsData));
  }
}

function createTable(data) {
  let rowData = '';
  data.map(val => {
    rowData += `<tr>
      <td>${val.num}</td>
      <td>${val.date}</td>
      <td>${val.amount}</td>
      <td>${val.originalAmount}</td>
      <td>${val.desc}</td>
      <td>${val.memo}</td>
    </tr>`;
  })
  tbody.innerHTML = rowData;
  table_rows = document.querySelectorAll('tbody tr');
  const col = getColumnByValue('Date');
  let dates = [...table_rows].map(tr => {
    return new Date(tr.children[col].textContent).getTime();
  });
  const first = new Date(Math.min(...dates)).toISOString().slice(0, 10);
  const last = new Date(Math.max(...dates)).toISOString().slice(0, 10);
  from.value = first;
  to.value = last;
  document.getElementById('range').innerHTML = `${first} - ${last}`;
  cards_data = extractCardsData();
  sortTable();
  calcSum();
  tableToCSV();
}

function getColumnByValue(val) {
  return [...table_headings]
    .map(th => th.textContent)
    .findIndex(el => el.match(/[\w ]+/g) == val);
}

function pieChart() {
  let pieData = anychart.data.set(cards_data);
  let chart = anychart.pie(pieData.mapAs({name: 0, value: 1, label: 2}));
  document.getElementById('pie').innerHTML = "";
  chart
    .labels()
    .format("{%label}")
    .fontSize(14);
  chart.title("Expenses Analysys");
  chart.container("pie");
  chart.draw();
}

function extractCardsData(rebuild = true) {
  let obj = {};
  [...table_rows]
    .filter(r=>r.classList[0]==undefined)
    .map(el => {
      const n = el.children[num_col].innerHTML;
      const a = el.children[amount_col].innerHTML;
      if (Object.keys(obj).includes(n)) {
        obj[n] += Number(parseFloat(a).toFixed(2));
      } else {
        obj[n] = Number(parseFloat(a).toFixed(2));
      }
    });
  // console.log('obj:', obj);
  const cards = Object.entries(obj);
  if (rebuild) {
    card_list.innerHTML = "";
    const len = cards.length;
    const root_css = window.getComputedStyle(root);
    const size = root_css.getPropertyValue('--font-size').match(/\d+/g)[0];
    // console.log('size:', (size*len).toString());
    root.style.setProperty('--len', (size*len*1.3).toString() + 'rem');
  }
  cards.forEach(card => {
    if (rebuild) {
      const el = document.createElement("option");
      el.textContent = card[0];
      el.value = card[0];
      card_list.appendChild(el);
    }
    card[1] = Number(card[1].toFixed(2));
    card[2] = card[1].toLocaleString();
  });
  // console.log('cards:', cards.map(el=>el[0]));
  return cards;
}

function filterTable(param = false) {
  const selected = [...card_list.options]
    .filter(el => param ? el : el.selected)
    .map(el => el.value);
  console.log('selected:', selected);
  table_rows.forEach(row => {
    const content = row.textContent.toLowerCase();
    const val = search.value.toLowerCase();
    const card_value = row.children[num_col].textContent;
    const date_value = row.children[date_col].textContent;
    const search_res = content.indexOf(val) < 0 && val != '';
    const card_res = !selected.includes(card_value);
    const date_res = date_value < from.value || date_value > to.value;
    const result = search_res || date_res || card_res;
    row.classList.toggle('hide', result);
  });
  cards_data = extractCardsData();
  calcSum();
}

function calcSum() {
  let tmp;
  const list = [...table_rows]
    .filter(r=>r.classList[0]==undefined)
    .map(el => el.children[amount_col].innerHTML);
  if (list.length == 0) {
    document.getElementById('sum').innerHTML = '0';
  } else {
    if (list.length == 1) {
      tmp = list[0];
    } else {
      tmp = list.reduce((a,b)=>parseFloat(a)+parseFloat(b)).toFixed(2);
    }
    const sum = parseFloat(tmp).toLocaleString();
    document.getElementById('sum').innerHTML = `${sum}&#8362;`;
  }
  pieChart();
}

function sortTable() {
  table_headings.forEach((head, col) => {
    let sort_asc = true;
    head.onclick = () => {
      table_headings.forEach(head => head.classList.remove('active'));
      head.classList.add('active');
      document.querySelectorAll('td').forEach(td => td.classList.remove('active'));
      table_rows.forEach(row => {
        row.querySelectorAll('td')[col].classList.add('active');
      })
      head.classList.toggle('asc', sort_asc);
      sort_asc = head.classList.contains('asc') ? false : true;
      [...table_rows].sort((a, b) => {
        a = a.querySelectorAll('td')[col].textContent;
        b = b.querySelectorAll('td')[col].textContent;
        const a_m = a.match(/-/g);
        const b_m = b.match(/-/g);
        let a_row = a_m == null ? parseInt(a) : a_m.length > 1 ? new Date(a).getTime() : parseInt(a);
        let b_row = b_m == null ? parseInt(b) : b_m.length > 1 ? new Date(b).getTime() : parseInt(b);
        return sort_asc ? b_row - a_row : a_row - b_row;
      }).map(sorted => document.querySelector('tbody').appendChild(sorted));
    };
  });
}

function tableToCSV() {
	let csv_data = [];
  table_rows.forEach(row => {
		let cols = row.querySelectorAll('td,th');
		let csvrow = [];
		for (let j = 0; j < cols.length; j++) {
			csvrow.push(cols[j].innerHTML);
		}
		csv_data.push(csvrow.join(","));
  });
  csv_data = csv_data.join('\n');
  downloadCSVFile(csv_data);
}

function downloadCSVFile(csv_data) {
	const CSVFile = new Blob([csv_data], { type: "text/csv;utf-16" });
  const range = document.getElementById('range').innerHTML.replace(' - ', '_');
	link.download = "cards_" + range + ".csv";
	let url = URL.createObjectURL(CSVFile);
	link.href = url;
  link.disabled = false;
}
