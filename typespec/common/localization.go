package common

import (
	"strings"
)

type FrontendLocale string

const (
	EnglishUnitedStates FrontendLocale = "en-US"
	Tamil               FrontendLocale = "ta"
	German              FrontendLocale = "de-DE"
)

type CountryCode string

type DisplayName string

func IsFrontendLocale(value FrontendLocale) bool {
	return value == EnglishUnitedStates ||
		value == Tamil ||
		value == German
}

func IsCountryCode(value CountryCode) bool {
	_, ok := countryCodes[value]
	return ok
}

var countryCodes = map[CountryCode]struct{}{
	"ABW": {}, "AFG": {}, "AGO": {}, "AIA": {}, "ALA": {},
	"ALB": {}, "AND": {}, "ARE": {}, "ARG": {}, "ARM": {},
	"ASM": {}, "ATA": {}, "ATF": {}, "ATG": {}, "AUS": {},
	"AUT": {}, "AZE": {}, "BDI": {}, "BEL": {}, "BEN": {},
	"BES": {}, "BFA": {}, "BGD": {}, "BGR": {}, "BHR": {},
	"BHS": {}, "BIH": {}, "BLM": {}, "BLR": {}, "BLZ": {},
	"BMU": {}, "BOL": {}, "BRA": {}, "BRB": {}, "BRN": {},
	"BTN": {}, "BVT": {}, "BWA": {}, "CAF": {}, "CAN": {},
	"CCK": {}, "CHE": {}, "CHL": {}, "CHN": {}, "CIV": {},
	"CMR": {}, "COD": {}, "COG": {}, "COK": {}, "COL": {},
	"COM": {}, "CPV": {}, "CRI": {}, "CUB": {}, "CUW": {},
	"CXR": {}, "CYM": {}, "CYP": {}, "CZE": {}, "DEU": {},
	"DJI": {}, "DMA": {}, "DNK": {}, "DOM": {}, "DZA": {},
	"ECU": {}, "EGY": {}, "ERI": {}, "ESH": {}, "ESP": {},
	"EST": {}, "ETH": {}, "FIN": {}, "FJI": {}, "FLK": {},
	"FRA": {}, "FRO": {}, "FSM": {}, "GAB": {}, "GBR": {},
	"GEO": {}, "GGY": {}, "GHA": {}, "GIB": {}, "GIN": {},
	"GLP": {}, "GMB": {}, "GNB": {}, "GNQ": {}, "GRC": {},
	"GRD": {}, "GRL": {}, "GTM": {}, "GUF": {}, "GUM": {},
	"GUY": {}, "HKG": {}, "HMD": {}, "HND": {}, "HRV": {},
	"HTI": {}, "HUN": {}, "IDN": {}, "IMN": {}, "IND": {},
	"IOT": {}, "IRL": {}, "IRN": {}, "IRQ": {}, "ISL": {},
	"ISR": {}, "ITA": {}, "JAM": {}, "JEY": {}, "JOR": {},
	"JPN": {}, "KAZ": {}, "KEN": {}, "KGZ": {}, "KHM": {},
	"KIR": {}, "KNA": {}, "KOR": {}, "KWT": {}, "LAO": {},
	"LBN": {}, "LBR": {}, "LBY": {}, "LCA": {}, "LIE": {},
	"LKA": {}, "LSO": {}, "LTU": {}, "LUX": {}, "LVA": {},
	"MAC": {}, "MAF": {}, "MAR": {}, "MCO": {}, "MDA": {},
	"MDG": {}, "MDV": {}, "MEX": {}, "MHL": {}, "MKD": {},
	"MLI": {}, "MLT": {}, "MMR": {}, "MNE": {}, "MNG": {},
	"MNP": {}, "MOZ": {}, "MRT": {}, "MSR": {}, "MTQ": {},
	"MUS": {}, "MWI": {}, "MYS": {}, "MYT": {}, "NAM": {},
	"NCL": {}, "NER": {}, "NFK": {}, "NGA": {}, "NIC": {},
	"NIU": {}, "NLD": {}, "NOR": {}, "NPL": {}, "NRU": {},
	"NZL": {}, "OMN": {}, "PAK": {}, "PAN": {}, "PCN": {},
	"PER": {}, "PHL": {}, "PLW": {}, "PNG": {}, "POL": {},
	"PRI": {}, "PRK": {}, "PRT": {}, "PRY": {}, "PSE": {},
	"PYF": {}, "QAT": {}, "REU": {}, "ROU": {}, "RUS": {},
	"RWA": {}, "SAU": {}, "SDN": {}, "SEN": {}, "SGP": {},
	"SGS": {}, "SHN": {}, "SJM": {}, "SLB": {}, "SLE": {},
	"SLV": {}, "SMR": {}, "SOM": {}, "SPM": {}, "SRB": {},
	"SSD": {}, "STP": {}, "SUR": {}, "SVK": {}, "SVN": {},
	"SWE": {}, "SWZ": {}, "SXM": {}, "SYC": {}, "SYR": {},
	"TCA": {}, "TCD": {}, "TGO": {}, "THA": {}, "TJK": {},
	"TKL": {}, "TKM": {}, "TLS": {}, "TON": {}, "TTO": {},
	"TUN": {}, "TUR": {}, "TUV": {}, "TWN": {}, "TZA": {},
	"UGA": {}, "UKR": {}, "UMI": {}, "URY": {}, "USA": {},
	"UZB": {}, "VAT": {}, "VCT": {}, "VEN": {}, "VGB": {},
	"VIR": {}, "VNM": {}, "VUT": {}, "WLF": {}, "WSM": {},
	"YEM": {}, "ZAF": {}, "ZMB": {}, "ZWE": {},
}

func NormalizeDisplayName(value DisplayName) DisplayName {
	return DisplayName(strings.TrimSpace(string(value)))
}

func IsDisplayName(value DisplayName) bool {
	length := len([]rune(NormalizeDisplayName(value)))
	return length >= 1 && length <= 200
}
