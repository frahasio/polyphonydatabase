FactoryBot.define do
  factory :edition do
    voicing { "ABCD" }

    transient do
      editor_name { nil }

      editor_options {
        {
          name: editor_name,
        }.compact_blank
      }
    end

    editor do
      if editor_name.present?
        association(:editor, **editor_options)
      end
    end
  end
end
