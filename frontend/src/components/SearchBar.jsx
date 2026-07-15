export default function SearchBar({ value, onChange }) {
    return (
        <div className="search-container">
            <i className="fas fa-search"></i>
            <input
                type="text"
                placeholder="بحث سريع عن طريق الاسم أو الرقم الوطني..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
