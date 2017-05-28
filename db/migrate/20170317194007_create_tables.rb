class CreateTables < ActiveRecord::Migration[5.0]
  def change
    create_table :pieces do |t|
      t.string :title, null: false
      t.timestamps
    end

    create_table :sources do |t|
      t.string :code, null: false
      t.string :title
      t.string :type
      t.string :format
      t.string :date_range
      t.string :publisher_or_scribe
      t.string :town
      t.string :rism_link
      t.string :url
      t.boolean :catalogued, null: false, default: false
      t.timestamps
    end

    create_table :inclusions do |t|
      t.references :source
      t.references :piece
      t.string :notes
      t.integer :order, null: false
      t.timestamps
    end

    create_table :clefs_inclusions do |t|
      t.references :clef
      t.references :inclusion
      t.boolean :missing, null: false, default: false
      t.boolean :partial, null: false, default: false
      t.integer :changes_to
      t.integer :changes_from
      t.timestamps
    end

    create_table :clefs do |t|
      t.string :note
      t.timestamps
    end

    create_table :composers do |t|
      t.string :name
      t.string :born
      t.string :died
      t.string :birthplace_1
      t.string :birthplace_2
      t.string :deathplace_1
      t.string :deathplace_2
      t.string :flourished_1
      t.string :flourished_2
      t.string :image_url
      t.timestamps
    end

    create_table :anonyms do |t|
      t.string :name
      t.timestamps
    end

    create_table :attributions do |t|
      t.references :inclusion
      t.references :alias
      t.references :composer
      t.references :anonym
      t.boolean :incorrectly_attributed
      t.timestamps
    end

    create_table :aliases do |t|
      t.references :composer
      t.references :anonym
      t.timestamps
    end

    create_table :editions do |t|
      t.string :voicing
      t.string :editor
      t.string :file_url
      t.references :piece
      t.timestamps
    end

    create_table :recordings do |t|
      t.string :performer
      t.string :file_url
      t.references :piece
      t.timestamps
    end
  end
end
