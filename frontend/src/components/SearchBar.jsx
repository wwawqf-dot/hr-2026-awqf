export default function SearchBar({ value, onChange }) {
    return (
        <div className="search-container">
            <i className="fas fa-search"></i>
            <input
                type="text"
                placeholder="البحث بالاسم أو الرقم الوظيفي..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
