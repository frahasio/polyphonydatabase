class AddNewInclusionFields < ActiveRecord::Migration[6.1]
  def change
    create_table :composition_types do |t|
      t.string :name
      t.timestamps
    end

    %w[
      Mass
      Psalm/Canticle
      Hymn
      Responsory
      Motet
      Antiphon
      Requiem
      Secular
    ].each { |name| CompositionType.create(name:) }

    add_belongs_to :compositions, :composition_type
    add_column :compositions, :tone, :integer
    add_column :compositions, :even_odd, :integer

    add_column :titles, :language, :integer
  end
end
