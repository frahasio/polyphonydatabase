class AddDisplayToClefCombination < ActiveRecord::Migration[7.1]
  def change
    add_column :clef_combinations, :display, :string

    reversible do |dir|
      dir.up do
        ClefCombination.find_each do |cc|
          if cc.inclusions.none? && cc.voicings.none?
            cc.destroy!
            next
          end

          cc.display = if cc.inclusions.none?
            cc.sorting
          else
            cc.inclusions.first.clef_inclusions.to_a
              .sort_by(&:sort_value)
              .map { |ci| ci.display(source_context: false) }
              .join
          end

          if (existing = ClefCombination.where(display: cc.display).to_a).present?
            existing.each do |existing_cc|
              existing_cc.voicings = (existing_cc.voicings + cc.voicings).uniq
              existing_cc.inclusions = (existing_cc.inclusions + cc.inclusions).uniq
              existing_cc.save!
            end

            cc.destroy!
          else
            cc.save!
          end
        end

        change_column_null :clef_combinations, :display, false
      end
    end

    add_index :clef_combinations, :display, unique: true
  end
end
