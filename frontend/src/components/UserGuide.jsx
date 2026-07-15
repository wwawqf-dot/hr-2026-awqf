import { useState } from 'react';

// Each section: an optional plain intro sentence, a list of bold-label
// points, and an optional placeholder screenshot. Sections without an
// "إضافة صورة" line in the spec (4 and 5) simply omit `image`.
const GUIDE_SECTIONS = [
    {
        id: 1,
        title: '1. كيفية إضافة وتسجيل موظف جديد',
        intro: 'يشرح هذا القسم طريقة إدخال البيانات الأساسية.',
        points: [
            {
                label: 'الاسم والرقم الوظيفي',
                text: 'بيانات أساسية لتعريف الموظف في النظام ومنع التكرار.',
            },
            {
                label: 'رصيد الإجازات الافتتاحي',
                text: 'يُقصد به الصافي التراكمي للإجازات المرحلة للموظف من السنوات السابقة (قبل بدء استخدام المنظومة الرقمية).',
            },
        ],
        image: { src: '/placeholders/add-emp.jpg', alt: 'واجهة إضافة موظف' },
    },
    {
        id: 2,
        title: '2. آلية خصم الإجازات والقيود الزمنية',
        points: [
            {
                label: 'طريقة الخصم',
                text: 'يتم الخصم بالضغط على الزر الأخضر (خصم) بجانب اسم الموظف.',
            },
            {
                label: 'قيد الـ 40 يوماً (الأثر الرجعي)',
                text: 'النظام مبرمج أمنياً لمنع تسجيل أي إجازة بتواريخ رجعية تتجاوز 40 يوماً من تاريخ اليوم الفعلي للمنظومة، وذلك لضمان الانضباط الإداري.',
            },
            {
                label: 'إجازة غير معروفة التواريخ',
                text: 'تُستخدم لخصم أيام محددة دون ربطها بتاريخ بداية ونهاية (وهي تتجاوز قيد الـ 40 يوماً).',
            },
            {
                label: 'حماية الأرصدة السالبة',
                text: 'المنظومة تمنع نهائياً تسجيل إجازة تتجاوز رصيد الموظف المتاح (الصافي التراكمي).',
            },
        ],
        image: { src: '/placeholders/deduction.jpg', alt: 'واجهة الخصم' },
    },
    {
        id: 3,
        title: '3. كيف تحسب المنظومة الإجازات والترحيل السنوي؟',
        points: [
            {
                label: 'رصيد بداية السنة',
                text: 'يمنح النظام الموظف 30 أو 45 يوماً كدفعة كاملة بداية كل سنة مالية.',
            },
            {
                label: 'الترحيل التلقائي (الجدول الممتد)',
                text: 'عند بدء سنة جديدة، تقوم المنظومة ذاتياً بحساب "الصافي التراكمي" المتبقي للموظف من السنة المنتهية، وترحله كـ "رصيد افتتاحي" للسنة الجديدة في عمود مستقل. لا حاجة لأي تدخل بشري في نقل الأرصدة.',
            },
        ],
        image: { src: '/placeholders/calc.jpg', alt: 'آلية الحساب' },
    },
    {
        id: 4,
        title: '4. تجميد الموظفين والطباعة',
        points: [
            {
                label: 'تجميد موظف',
                text: 'يُستخدم لإيقاف حسابات موظف (نقل، إيقاف عن العمل، أو استقالة) بحيث ينزل اسمه لأسفل القائمة مع علامة حمراء "مُجمّد" دون حذف بياناته التاريخية.',
            },
            {
                label: 'طباعة كشف فردي',
                text: 'يُصدر تقريراً مفصلاً لكل حركات الخصم الخاصة بموظف واحد.',
            },
            {
                label: 'الطباعة الإجمالية',
                text: 'لطباعة الجدول الكامل للإدارة، وهو مهيأ تلقائياً ليتناسب مع قياس ورق A4 عرضي.',
            },
        ],
    },
    {
        id: 5,
        title: '5. الأمان، النسخ الاحتياطي، ومزامنة السحابة (JSON)',
        intro: 'تعتمد المنظومة على تقنية القراءة من ملفات JSON لضمان عملها بدون إنترنت.',
        points: [
            {
                label: 'استيراد البيانات',
                text: 'لسحب نسخة احتياطية سابقة وعرضها في النظام.',
            },
            {
                label: 'تصدير/مزامنة',
                text: 'بعد إنهاء العمل اليومي، يجب الضغط على "حفظ وتصدير" لتحميل ملف التحديث، والذي يمكن رفعه لاحقاً للنسخة السحابية لتبقى الإدارة على اطلاع دائم.',
            },
        ],
    },
];

export default function UserGuide() {
    // Classic accordion: one open section at a time. The first section is
    // open by default so the guide isn't a wall of collapsed bars on load.
    const [openId, setOpenId] = useState(GUIDE_SECTIONS[0].id);

    return (
        <div className="user-guide">
            {GUIDE_SECTIONS.map((section) => {
                const isOpen = openId === section.id;
                return (
                    <div key={section.id} className={`guide-item${isOpen ? ' open' : ''}`}>
                        <button
                            type="button"
                            className="guide-summary"
                            onClick={() => setOpenId(isOpen ? null : section.id)}
                            aria-expanded={isOpen}
                        >
                            <span>{section.title}</span>
                            <i className="fas fa-chevron-down guide-chevron"></i>
                        </button>

                        <div className="guide-body" style={{ maxHeight: isOpen ? '700px' : '0px' }}>
                            <div className="guide-body-inner">
                                {section.intro && <p className="guide-intro">{section.intro}</p>}

                                <ul className="guide-points">
                                    {section.points.map((point) => (
                                        <li key={point.label} className="guide-point">
                                            <strong>{point.label}:</strong> {point.text}
                                        </li>
                                    ))}
                                </ul>

                                {section.image && (
                                    <figure className="guide-img-frame">
                                        <img src={section.image.src} alt={section.image.alt} className="guide-img" />
                                        <figcaption>{section.image.alt}</figcaption>
                                    </figure>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
