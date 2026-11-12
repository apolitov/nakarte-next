from build import norm_cat, parse_coord

def test_cat():
    assert norm_cat('1a') == '1А' and norm_cat('2Б*') == '2Б' and norm_cat('н/к') == 'нк' and norm_cat('nc') == 'нк'
    assert norm_cat('1Б-2А') == '1Б' and norm_cat('?') is None

def test_coord():
    lat, lon = parse_coord('N 49°52.759’\n E 85°33.309’')
    assert abs(lat - 49.879317) < 1e-5 and abs(lon - 85.55515) < 1e-5
    lat, lon = parse_coord("N 43°12'30\" E 42°05'00\"")
    assert abs(lat - 43.208333) < 1e-5 and abs(lon - 42.083333) < 1e-5
    assert parse_coord('нет') is None
